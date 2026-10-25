import type { AuthRealm } from "@/lib/auth/auth-realm";

/** Presentation only: database names, IDs and persisted enum values never depend on wording. */
const ESTIO = {
  tenant: "location", tenants: "locations", tenantTitle: "Location", tenantsTitle: "Locations",
  chooseTenant: "Choose a location", switchTenant: "Switch location", unnamedTenant: "Unnamed location",
  availableTenants: "Available locations", allContacts: "All location", assignedPerson: "Assigned Agent",
  person: "Agent", selectPerson: "Select Agent", notAssigned: "Not Assigned To An Agent",
  leadCategory: "Real Estate", businessCategory: "Business", item: "Property", items: "Properties",
  meeting: "Viewing", projectCompany: "Developer", projectCompanyLower: "developer", projectArea: "Location / Area",
  projectSummary: "Manage your development projects.", projectTarget: "Completion Date",
};
type Vocabulary = { [K in keyof typeof ESTIO]: string };
const SUBSTO: Vocabulary = {
  tenant: "brand", tenants: "brands", tenantTitle: "Brand", tenantsTitle: "Brands",
  chooseTenant: "Choose a brand", switchTenant: "Switch brand", unnamedTenant: "Unnamed brand",
  availableTenants: "Available brands", allContacts: "All brand contacts", assignedPerson: "Assigned team member",
  person: "Team member", selectPerson: "Select team member", notAssigned: "Not Assigned To A Team Member",
  leadCategory: "Leads & contacts", businessCategory: "Partners & companies", item: "Item", items: "Items",
  meeting: "Meeting", projectCompany: "Company", projectCompanyLower: "company", projectArea: "Project area",
  projectSummary: "Manage your projects and the companies you work with.", projectTarget: "Target date",
};
export function crmVocabulary(realm: AuthRealm): Vocabulary { return realm === "substo" ? SUBSTO : ESTIO; }
export function crmStageLabel(realm: AuthRealm, value: string): string {
  return value === "Viewing" ? crmVocabulary(realm).meeting : value;
}
export function crmGoalLabel(realm: AuthRealm, value: string | null | undefined): string {
  if (!value) return "";
  return realm === "substo" && ["To Buy", "To Rent", "To List", "Other"].includes(value) ? "General enquiry" : value;
}
export function crmGoalValues(realm: AuthRealm, current?: string | null): readonly string[] {
  const existing = ["To Buy", "To Rent", "To List", "Other"];
  if (realm === "estio") return existing;
  // Keep a saved legacy value selectable so opening/saving the form never rewrites it.
  return current && existing.includes(current) && current !== "Other" ? [current, "Other"] : ["Other"];
}
export const SUBSTO_CONTACT_TYPES = ["Lead", "Agent", "Partner", "Associate", "Company", "Contact"] as const;
const CONTACT_LABELS: Record<string, string> = {
  Lead: "Lead", Agent: "Professional", Partner: "Partner", Associate: "Associate", Company: "Company", Contact: "Contact",
  Owner: "Lead", Tenant: "Lead", Maintenance: "Contact", WhatsAppGroup: "Group", Buyer: "Lead", Seller: "Lead",
};
export function crmContactTypeLabel(realm: AuthRealm, value: string): string {
  return realm === "substo" ? CONTACT_LABELS[value] ?? "Contact" : value === "WhatsAppGroup" ? "WhatsApp Group" : value;
}
