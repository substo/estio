import assert from "node:assert/strict";
import test from "node:test";
import React, { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { AppLogo } from "@/components/app-logo";
import { BrandExperience } from "@/components/wrapper/brand-experience";
import { appIdentity } from "./app-identity";
import { crmVocabulary, crmContactTypeLabel, crmGoalLabel, crmGoalValues, crmStageLabel, SUBSTO_CONTACT_TYPES } from "./crm-vocabulary";
import { contactTypeConfigForApp, CONTACT_TYPE_CONFIG, CONTACT_TYPES, LEAD_GOALS, LEAD_STAGES } from "@/app/(main)/admin/contacts/_components/contact-types";

(globalThis as { React?: typeof React }).React = React;

test("Substo logo follows the verified app context and remains accessible when collapsed", () => {
  for (const compact of [false, true]) {
    const html = renderToStaticMarkup(createElement(BrandExperience, { brand: "substo", children: createElement(AppLogo, { href: "/admin", iconOnly: compact, showName: true }) }));
    assert.match(html, /Substo/);
    assert.match(html, /href="\/admin"/);
    assert.doesNotMatch(html, /[Ee]stio|<img/);
    if (compact) assert.match(html, /sr-only/);
  }
});

test("Estio keeps its existing image logo and explicit product app overrides work", () => {
  const html = renderToStaticMarkup(createElement(AppLogo, { app: "estio", showName: true }));
  assert.match(html, /alt="Estio"/);
  assert.match(html, /estio%20logo|estio logo/);
  assert.doesNotMatch(html, /Substo/);
  const explicit = renderToStaticMarkup(createElement(AppLogo, { app: "substo", href: "/studio" }));
  assert.match(explicit, /Substo/);
  assert.match(explicit, /href="\/studio"/);
});

test("Substo vocabulary names the brand, assignee and meeting while Estio wording stays intact", () => {
  const generic = crmVocabulary("substo");
  assert.equal(generic.tenant, "brand");
  assert.equal(generic.switchTenant, "Switch brand");
  assert.equal(generic.person, "Team member");
  assert.equal(generic.projectCompany, "Company");
  assert.equal(crmStageLabel("substo", "Viewing"), "Meeting");
  assert.equal(crmStageLabel("estio", "Viewing"), "Viewing");
  assert.equal(crmVocabulary("estio").switchTenant, "Switch location");
  assert.equal(appIdentity("substo").name, "Substo");
  assert.doesNotMatch(appIdentity("substo").description, /estate|Estio|GoHighLevel/i);
});

test("all Substo contact configurations are generic and never require a property", () => {
  for (const type of CONTACT_TYPES) {
    const generic = contactTypeConfigForApp("substo", type);
    assert.deepEqual(generic.visibleTabs, ["details"]);
    assert.equal(generic.entityRequired, false);
    assert.notEqual(generic.entityType, "property");
    assert.notEqual(generic.entityType, "either");
    assert.doesNotMatch(generic.description, /property|real estate|rent|purchas/i);
    // Estio returns its existing exact configuration, including roles and property tabs.
    assert.equal(contactTypeConfigForApp("estio", type), CONTACT_TYPE_CONFIG[type]);
  }
  assert.equal(contactTypeConfigForApp("substo", "Partner").entityType, "company");
  assert.equal(contactTypeConfigForApp("substo", "Company").impliedRole, "company_contact");
  assert.ok(!([...SUBSTO_CONTACT_TYPES] as string[]).includes("Tenant"));
  assert.ok(!([...SUBSTO_CONTACT_TYPES] as string[]).includes("Owner"));
  assert.equal(crmContactTypeLabel("substo", "Owner"), "Lead");
  assert.equal(crmContactTypeLabel("substo", "Agent"), "Professional");
});

test("generic labels preserve all saved goal and pipeline values", () => {
  assert.deepEqual(crmGoalValues("estio"), [...LEAD_GOALS]);
  assert.deepEqual(crmGoalValues("substo"), ["Other"]);
  for (const saved of LEAD_GOALS) {
    assert.ok(crmGoalValues("substo", saved).includes(saved));
    assert.equal(crmGoalLabel("substo", saved), "General enquiry");
    assert.equal(crmGoalLabel("estio", saved), saved);
  }
  assert.ok(LEAD_STAGES.includes("Viewing"));
  assert.ok(!([...LEAD_STAGES] as string[]).includes("Meeting"));
});
