"use client";

import { createContext, useContext } from "react";
import { crmVocabulary } from "@/lib/branding/crm-vocabulary";
import type { AuthRealm } from "@/lib/auth/auth-realm";

const CrmRealmContext = createContext<AuthRealm>("estio");
export const CrmRealmProvider = CrmRealmContext.Provider;
export const useCrmRealm = () => useContext(CrmRealmContext);

export const useCrmVocabulary = () => crmVocabulary(useCrmRealm());
