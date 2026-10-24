"use client";

import { createContext, useContext } from "react";
import type { AuthRealm } from "@/lib/auth/auth-realm";

const CrmRealmContext = createContext<AuthRealm>("estio");
export const CrmRealmProvider = CrmRealmContext.Provider;
export const useCrmRealm = () => useContext(CrmRealmContext);
