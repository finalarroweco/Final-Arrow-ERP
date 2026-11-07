// An approval must be both readable and actionable within the same company/branch.
export function intersectBranches(read: string[] | null | false,
  manage: string[] | null | false): string[] | null | false {
  if (read === false || manage === false) return false;
  if (read === null) return manage;
  if (manage === null) return read;
  const allowed = read.filter((id) => manage.includes(id));
  return allowed.length ? allowed : false;
}
