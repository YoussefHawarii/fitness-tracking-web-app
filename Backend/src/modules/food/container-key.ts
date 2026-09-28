import { ContainerKey } from '@prisma/client';

const SHAPE_TO_CONTAINER: Readonly<Record<string, ContainerKey>> = {
  'en:can': ContainerKey.CAN,
  'en:drink-can': ContainerKey.CAN,
  'en:bottle': ContainerKey.BOTTLE,
  'en:jar': ContainerKey.JAR,
  'en:pot': ContainerKey.JAR,
  'en:box': ContainerKey.BOX,
  'en:bag': ContainerKey.BAG,
  'en:packet': ContainerKey.BAG,
};

const SECONDARY_SHAPES = new Set([
  'en:bottle-cap',
  'en:envelope',
  'en:fastener',
  'en:film',
  'en:individual-bag',
  'en:label',
  'en:lid',
  'en:seal',
  'en:sheet',
  'en:sleeve',
]);

// OFF lists every packaging component. Provider order is retained, but
// closures and secondary wraps are skipped so the first mapped physical
// container becomes the display noun. Unknown and generic tags do not mask a
// later meaningful tag; PACKAGE is used only if none can be mapped.
export function mapOffPackagingShapes(
  packagings: ReadonlyArray<{ shape?: string | null }> | null | undefined,
): ContainerKey {
  for (const packaging of packagings ?? []) {
    if (typeof packaging.shape !== 'string') continue;
    const shape = packaging.shape.trim().toLowerCase();
    if (!shape || SECONDARY_SHAPES.has(shape) || shape === 'en:container') {
      continue;
    }
    const container = SHAPE_TO_CONTAINER[shape];
    if (container) return container;
  }
  return ContainerKey.PACKAGE;
}
