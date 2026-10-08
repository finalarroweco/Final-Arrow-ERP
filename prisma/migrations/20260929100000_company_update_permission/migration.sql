INSERT INTO "Permission" ("key") VALUES ('company:update')
ON CONFLICT ("key") DO NOTHING;

INSERT INTO "RolePermission" ("tenantId", "roleId", "permissionKey")
SELECT "tenantId", "id", 'company:update'
FROM "Role" WHERE "name" = 'Owner'
ON CONFLICT ("tenantId", "roleId", "permissionKey") DO NOTHING;
