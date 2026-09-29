"use client";

import { useCallback, useEffect, useState } from "react";

type Member = {
  id: string; userId: string; name: string; email: string; status: string;
  grants: { role: string; scopes: { type: string; companyId: string | null; branchId: string | null }[] }[];
};
type Invitation = {
  id: string; email: string; role: string; type: string;
  companyId: string | null; branchId: string | null; expiresAt: string;
};

export function TeamPanel({ tenantId, currentUserId }: { tenantId: string; currentUserId: string }) {
  const [members, setMembers] = useState<Member[]>([]);
  const [invitations, setInvitations] = useState<Invitation[]>([]);
  const [error, setError] = useState("");
  const refresh = useCallback(async () => {
    const response = await fetch(`/api/team?tenantId=${tenantId}`);
    if (!response.ok) { setError("Could not load the team."); return; }
    const result: { members: Member[]; invitations: Invitation[] } = await response.json();
    setMembers(result.members); setInvitations(result.invitations); setError("");
  }, [tenantId]);

  useEffect(() => {
    void refresh();
    window.addEventListener("erp:invitation-created", refresh);
    return () => window.removeEventListener("erp:invitation-created", refresh);
  }, [refresh]);

  async function changeStatus(member: Member) {
    const status = member.status === "ACTIVE" ? "SUSPENDED" : "ACTIVE";
    const response = await fetch(`/api/team/${member.id}`, {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tenantId, status }),
    });
    if (!response.ok) { setError("Could not change member status."); return; }
    await refresh();
  }

  async function revoke(invitation: Invitation) {
    const response = await fetch(`/api/invitations/${invitation.id}?tenantId=${tenantId}`, { method: "DELETE" });
    if (!response.ok) { setError("Could not revoke invitation."); return; }
    await refresh();
  }

  return <section className="team-panel">
    <h3>Team access</h3>
    {error && <p role="alert">{error}</p>}
    <h4>Members</h4>
    <ul>{members.map((member) => <li key={member.id}>
      <div><strong>{member.name}</strong> · {member.email}<br />
        <small>{member.grants.map((grant) => `${grant.role}: ${grant.scopes.map((scope) => scope.type.toLowerCase()).join(", ")}`).join(" · ")} · {member.status.toLowerCase()}</small></div>
      {member.userId !== currentUserId && !member.grants.some((grant) => grant.role === "Owner") &&
        <button type="button" onClick={() => void changeStatus(member)}>
          {member.status === "ACTIVE" ? "Suspend" : "Reactivate"}
        </button>}
    </li>)}</ul>
    <h4>Pending invitations</h4>
    {invitations.length === 0 ? <p>No pending invitations.</p> : <ul>{invitations.map((invitation) => <li key={invitation.id}>
      <div>{invitation.email}<br /><small>{invitation.role} · {invitation.type.toLowerCase()} · expires {new Date(invitation.expiresAt).toLocaleDateString()}</small></div>
      <button type="button" onClick={() => void revoke(invitation)}>Revoke</button>
    </li>)}</ul>}
  </section>;
}
