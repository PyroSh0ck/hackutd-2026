// App feature navigation. The feature generator inserts one line per generated feature
// directly below the marker comment. Hand-written entries may go anywhere else.
export type FeatureNavItem = { id: string; label: string; href: `/${string}` };

export const featureNavigation: readonly FeatureNavItem[] = [
  // generator:nav-items
];
