-- Existing tenants were created before CRM and sales permissions were seeded.
INSERT INTO "Permission" ("key")
SELECT key FROM (VALUES
  ('customer:read'), ('customer:create'), ('customer:update'), ('customer:archive'),
  ('lead:read'), ('lead:create'), ('lead:update'), ('lead:convert'),
  ('quote:read'), ('quote:create'), ('quote:update'), ('quote:send'), ('quote:decide')
) AS permissions(key)
ON CONFLICT ("key") DO NOTHING;

INSERT INTO "RolePermission" ("tenantId", "roleId", "permissionKey")
SELECT role."tenantId", role."id", permissions.key
FROM "Role" AS role
CROSS JOIN (VALUES
  ('customer:read', true, true), ('customer:create', true, false),
  ('customer:update', true, false), ('customer:archive', true, false),
  ('lead:read', true, true), ('lead:create', true, false),
  ('lead:update', true, false), ('lead:convert', true, false),
  ('quote:read', true, true), ('quote:create', true, false),
  ('quote:update', true, false), ('quote:send', true, false),
  ('quote:decide', true, false)
) AS permissions(key, manager_allowed, viewer_allowed)
WHERE role."name" = 'Owner'
  OR (role."name" = 'Manager' AND permissions.manager_allowed)
  OR (role."name" = 'Viewer' AND permissions.viewer_allowed)
ON CONFLICT ("tenantId", "roleId", "permissionKey") DO NOTHING;
