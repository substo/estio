"use client";

import { createContext, useContext, type ReactNode } from "react";
import type { HostBrand } from "@/lib/auth/host-brand";

const BrandExperienceContext = createContext<HostBrand>("estio");

export function BrandExperience({ brand, children }: { brand: HostBrand; children: ReactNode }) {
  return (
    <BrandExperienceContext.Provider value={brand}>
      <div data-experience-brand={brand}>{children}</div>
    </BrandExperienceContext.Provider>
  );
}

export function useBrandExperience() {
  return useContext(BrandExperienceContext);
}
