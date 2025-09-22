export type ProjectMetadata = {
  _id: string;
  _creationTime: number;
  project_id: string;
  priority?: number;
  scheduled_date?: string;
  description?: string;
  project_type?: "area-of-responsibility" | "project-type";
  source_task_id?: string;
  last_updated: number;
  sync_version: number;
};

export type ProjectMetadataInput = {
  project_id: string;
  priority?: number;
  scheduled_date?: string;
  description?: string;
  project_type?: "area-of-responsibility" | "project-type";
  source_task_id?: string;
  last_updated: number;
  sync_version: number;
};