"use client";

import { useState, type FormEvent } from "react";

type Company = { id: string; name: string; branches: { id: string; name: string }[] };

export function InviteForm({ tenantId, companies }: { tenantId: string; companies: Company[] }) {
  const [type, setType] = useState<"TENANT" | "COMPANY" | "BRANCH">("TENANT");
  const [companyId, setCompanyId] = useState("");
  const [link, setLink] = useState("");
  const [error, setError] = useState("");
  const selected = companies.find((company) => company.id === companyId);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(""); setLink("");
    const form = new FormData(event.currentTarget);
    const scope = type === "TENANT" ? { type } : type === "COMPANY"
      ? { type, companyId } : { type, companyId, branchId: String(form.get("branchId") ?? "") };
    const response = await fetch("/api/invitations", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tenantId, email: form.get("email"), role: form.get("role"), scope }),
    });
    if (!response.ok) { setError("Could not create the invitation. Check the selected scope."); return; }
    const result: { path: string } = await response.json();
    setLink(window.location.origin + result.path);
  }

  return <section className="invite-panel">
    <h3>Invite a team member</h3>
    <form onSubmit={submit} className="formrow">
      <input name="email" type="email" placeholder="Work email" required />
      <select name="role" aria-label="Role"><option>Viewer</option><option>Manager</option></select>
      <select value={type} onChange={(e) => { setType(e.target.value as typeof type); setCompanyId(""); }} aria-label="Scope">
        <option value="TENANT">Entire organization</option>
        <option value="COMPANY">One company</option>
        <option value="BRANCH">One branch</option>
      </select>
      {type !== "TENANT" && <select value={companyId} onChange={(e) => setCompanyId(e.target.value)} required aria-label="Company">
        <option value="">Select company</option>
        {companies.map((company) => <option key={company.id} value={company.id}>{company.name}</option>)}
      </select>}
      {type === "BRANCH" && <select name="branchId" required aria-label="Branch" key={companyId}>
        <option value="">Select branch</option>
        {selected?.branches.map((branch) => <option key={branch.id} value={branch.id}>{branch.name}</option>)}
      </select>}
      <button type="submit">Create invitation</button>
    </form>
    {error && <p role="alert">{error}</p>}
    {link && <p>Share this one-time link securely with the invited person. It expires in seven days.<br /><a href={link}>{link}</a></p>}
  </section>;
}
