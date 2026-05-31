DEFINE TABLE entity SCHEMALESS;
DEFINE TABLE relation SCHEMALESS;
DEFINE TABLE deployment SCHEMALESS;
DEFINE TABLE collector SCHEMALESS;
DEFINE TABLE insight SCHEMALESS;

DEFINE INDEX entity_uid ON entity FIELDS uid UNIQUE;
DEFINE INDEX entity_kind_name ON entity FIELDS kind, name;
DEFINE INDEX entity_external_id ON entity FIELDS externalId;
DEFINE INDEX relation_uid ON relation FIELDS uid UNIQUE;
DEFINE INDEX relation_from ON relation FIELDS from;
DEFINE INDEX relation_to ON relation FIELDS to;
DEFINE INDEX deployment_uid ON deployment FIELDS uid UNIQUE;
DEFINE INDEX deployment_project_env ON deployment FIELDS projectId, environment;
DEFINE INDEX collector_uid ON collector FIELDS uid UNIQUE;
DEFINE INDEX collector_target ON collector FIELDS target;
DEFINE INDEX insight_uid ON insight FIELDS uid UNIQUE;
