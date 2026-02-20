import { workflowDocSchema, type WorkflowDoc } from "@shared/schema/workflow";

export function validateWorkflowDoc(input: unknown): { ok: true; data: WorkflowDoc } | { ok: false; errors: string[] } {
  const result = workflowDocSchema.safeParse(input);
  if (result.success) return { ok: true, data: result.data };
  return {
    ok: false,
    errors: result.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`),
  };
}
