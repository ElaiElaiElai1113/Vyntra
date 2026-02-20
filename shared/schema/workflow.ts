import { z } from "zod";

export const allowedNodeTypes = [
  "trigger.manual",
  "trigger.webhook",
  "trigger.schedule",
  "trigger.file_upload",
  "ai.summarize",
  "ai.classify",
  "ai.extract_fields",
  "ai.generate_report",
  "logic.condition",
  "logic.delay",
  "output.db_save",
  "output.export",
] as const;

export const triggerNodeTypes = [
  "trigger.manual",
  "trigger.webhook",
  "trigger.schedule",
  "trigger.file_upload",
] as const;

export const nodePortSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  schema: z.string().min(1),
});

export const nodeSchema = z.object({
  id: z.string().min(1),
  type: z.enum(allowedNodeTypes),
  name: z.string().min(1),
  position: z.object({
    x: z.number(),
    y: z.number(),
  }),
  inputs: z.array(nodePortSchema),
  outputs: z.array(nodePortSchema).min(1),
  config: z.record(z.string(), z.unknown()),
  ui: z.object({
    icon: z.string().min(1),
    color: z.string().min(1),
  }),
});

export const edgeSchema = z.object({
  id: z.string().min(1),
  source: z.object({
    node_id: z.string().min(1),
    port_id: z.string().min(1),
  }),
  target: z.object({
    node_id: z.string().min(1),
    port_id: z.string().min(1),
  }),
  label: z.string().nullable(),
  condition: z.string().nullable(),
});

export const workflowSchema = z.object({
  id: z.string().regex(/^wf_[a-zA-Z0-9_-]+$/, "workflow.id must start with wf_"),
  name: z.string().min(1),
  description: z.string().min(1),
  tags: z.array(z.string()).default([]),
  entry_node_id: z.string().min(1),
  variables: z.record(z.string(), z.unknown()).default({}),
  nodes: z.array(nodeSchema).min(1),
  edges: z.array(edgeSchema),
});

export const workflowDocSchema = z
  .object({
    schema_version: z.literal("1.0"),
    workflow: workflowSchema,
  })
  .superRefine((doc, ctx) => {
    const nodes = doc.workflow.nodes;
    const edges = doc.workflow.edges;

    const triggerNodes = nodes.filter((n) => triggerNodeTypes.includes(n.type as (typeof triggerNodeTypes)[number]));
    if (triggerNodes.length !== 1) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["workflow", "nodes"],
        message: "Exactly one trigger node is required.",
      });
    }

    if (triggerNodes[0] && doc.workflow.entry_node_id !== triggerNodes[0].id) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["workflow", "entry_node_id"],
        message: "entry_node_id must point to the trigger node.",
      });
    }

    const nodeIds = new Set<string>();
    for (const n of nodes) {
      if (nodeIds.has(n.id)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["workflow", "nodes"],
          message: `Duplicate node id: ${n.id}`,
        });
      }
      nodeIds.add(n.id);

      if (triggerNodeTypes.includes(n.type as (typeof triggerNodeTypes)[number]) && n.inputs.length !== 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["workflow", "nodes"],
          message: `Trigger node ${n.id} must have no inputs.`,
        });
      }

      if (!triggerNodeTypes.includes(n.type as (typeof triggerNodeTypes)[number]) && n.inputs.length < 1) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["workflow", "nodes"],
          message: `Non-trigger node ${n.id} must have at least one input.`,
        });
      }

      if (n.type === "logic.condition") {
        if (n.outputs.length < 2) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["workflow", "nodes"],
            message: `Condition node ${n.id} must have at least two outputs.`,
          });
        }

        const defaultOutput = n.config.default_output;
        const outputIds = new Set(n.outputs.map((o) => o.id));
        if (typeof defaultOutput !== "string" || !outputIds.has(defaultOutput)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["workflow", "nodes"],
            message: `Condition node ${n.id} default_output must match an output port id.`,
          });
        }
      }
    }

    const edgeIds = new Set<string>();
    for (const e of edges) {
      if (edgeIds.has(e.id)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["workflow", "edges"],
          message: `Duplicate edge id: ${e.id}`,
        });
      }
      edgeIds.add(e.id);

      const sourceNode = nodes.find((n) => n.id === e.source.node_id);
      const targetNode = nodes.find((n) => n.id === e.target.node_id);

      if (!sourceNode) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["workflow", "edges"],
          message: `Edge ${e.id} source node not found.`,
        });
      } else if (!sourceNode.outputs.some((p) => p.id === e.source.port_id)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["workflow", "edges"],
          message: `Edge ${e.id} source port must reference an output port.`,
        });
      }

      if (!targetNode) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["workflow", "edges"],
          message: `Edge ${e.id} target node not found.`,
        });
      } else if (!targetNode.inputs.some((p) => p.id === e.target.port_id)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["workflow", "edges"],
          message: `Edge ${e.id} target port must reference an input port.`,
        });
      }
    }
  });

export type WorkflowDoc = z.infer<typeof workflowDocSchema>;
export type WorkflowNode = z.infer<typeof nodeSchema>;
export type WorkflowEdge = z.infer<typeof edgeSchema>;
