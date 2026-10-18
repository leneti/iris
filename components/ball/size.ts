/** The sphere's radius as a share of its box, per layout. The WebGL ball and its static stand-in agree on it. */
export const SIZE = { desktop: 0.86, phone: 0.82 } as const;

export type BallVariant = keyof typeof SIZE;
