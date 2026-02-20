import type { WorkflowDoc } from "@shared/schema/workflow";

export type WorkflowRow = {
  id: string;
  name: string;
  description: string;
  prompt: string;
  tags: string[];
  definition_json: WorkflowDoc;
  created_at: string;
  updated_at: string;
};

export type TemplateRow = {
  id: string;
  name: string;
  description: string;
  category: string;
  tags: string[];
  definition_json: WorkflowDoc;
};

export type RunRow = {
  id: string;
  status: "success" | "failed";
  workflow_id: string;
  input_json: Record<string, unknown>;
  output_json: Record<string, unknown>;
  steps: Array<Record<string, unknown>>;
  created_at: string;
};
