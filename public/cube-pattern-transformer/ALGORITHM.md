# Cube pattern solver representation

This directory contains a backend-first solver for visual sticker patterns on
2x2x2 through 5x5x5 cubes. The full sticker permutation produced by
`CubeModel` is the final correctness oracle.

## Physical and visual layers

The group layer always keeps physical identities distinct:

```text
solved home positions define distinct physical piece identities
                         |
                         | legal move permutation
                         v
distinct physical piece positions and sticker orientations
                         ^
                         | matching / assignment
                         |
visual sticker colors supplied by the user
```

`orbit.pieceIndices` is an ordered list of solved home positions. Algorithms
may use the same indices as position coordinates, but visual color equality
must never merge those coordinates in the group representation.

Visual indistinguishability is handled only while matching a sticker target to
a physical assignment. Center stickers of the same color are freely
interchangeable inside a center orbit. Wings with the same unordered color
signature are not automatically freely interchangeable: their handedness and
the orientation convention at the source and target positions must also agree.

## Orbit representations

### Corners

- Eight distinct physical corner identities.
- A permutation of eight positions.
- A position-dependent orientation in `Z/3Z`.
- Sticker slots at every corner are ordered with positive determinant. The
  orientation value is the cyclic offset from the identity's home ordering to
  the ordering at the current position.
- Legal states satisfy a zero corner-orientation sum modulo three.

The current corner solver is a stage solver. Its outer-face moves can disturb
edge and center orbits, and its returned `effects` field records that fact.

### Twelve-piece middle-edge orbit

- Twelve distinct physical edge identities.
- A permutation of twelve positions.
- A position-dependent orientation in `Z/2Z`.
- The orientation value compares the identity's home sticker order with the
  face-order sticker slots at the current position; it is not an absolute bit
  carried independently of position.
- Legal states satisfy a zero edge-orientation sum modulo two.

The oriented 3-cycle database and its rank-eleven flip basis operate on this
12-piece-plus-orientation representation.

The first-version solver implements the full `A_12` permutation projection and
the rank-eleven even-flip space. An odd requested permutation is reported as an
unsupported subgroup, not as proof that the complete visual target is
unreachable or that a parity coordinator is necessarily required.

### Twenty-four-piece wing orbit

- Twenty-four distinct physical wing identities and twenty-four physical
  positions.
- Forty-eight stickers belong to the orbit, but stickers are not orbit
  elements.
- There is no independent wing-orientation coordinate in this representation.
  Apparent orientation bits produced by face-order sticker slots are a
  position convention. A position gauge converts them into a handedness value
  that is invariant while a physical wing moves.
- A same-colored pair consists of two opposite-handed physical wings. Matching
  a visual target must preserve handedness; unordered color equality alone is
  insufficient.
- Visual legality is checked by comparing the gauge-corrected handedness
  inventory for every color signature. This is a physical-assignment check,
  not a 24-bit edge-orientation sum.
- Permutation parity always means parity of the permutation of these twenty-four
  distinct physical identities/positions. It is not parity from a
  twelve-piece-plus-orientation representation.

The canonical local wing commutator and its conjugates cover every directed
physical 3-cycle:

```text
2 * C(24, 3) = 4048
```

Consequently their position-permutation projection generates `A_24`. On the
4x4x4, a separately certified odd primitive is made wing-local by repairing its
even center permutation. Therefore the implemented 4x4x4 wing solver covers
`S_24`. The first-version 5x5x5 solver deliberately remains restricted to
`A_24`; rejection of an odd assignment there is an implementation boundary,
not a reachability verdict.

### Twenty-four-piece center orbit

- Twenty-four distinct physical center identities.
- One sticker per identity; there is no orientation coordinate.
- Same-colored identities are visually interchangeable during target
  assignment, so one such swap may normalize assignment parity.
- All 4048 directed local 3-cycles are available, generating `A_24`.

## Local primitives and stage solvers

An orbit-local primitive must be identity on every sticker outside its declared
target orbit. Locality is verified with `CubeModel.algorithmOrbitEffects()`.
Conjugating a local primitive by a legal move remains local because legal moves
preserve every derived orbit as a set.

A stage solver only promises to reach its target orbit. It may disturb orbits
scheduled for later stages and must return the full list of collateral effects.

Failure of a local solver means only that the requested physical assignment is
outside the subgroup currently implemented by that solver. It does not prove
that the visual target is globally unreachable.

## Restricted end-to-end pipeline

`createRestrictedPatternSolver(model)` is the backend-first composition of the
certified solvers. It deliberately has no parity coordinator or raw-move search.
Its stage order is:

```text
2x2x2: corners
3x3x3: corners -> middle edges
4x4x4: corners -> wings -> center-0
5x5x5: corners -> middle edges -> wings -> center-1 -> center-2
```

After every stage, all completed orbit stickers are compared with the target.
The concatenated result is finally replayed from the original source through
the full sticker model. A later stage changing a locked orbit is an
implementation error, not a solver limitation.

The first version has explicit boundaries:

- odd-cube six-center visual stickers must already match because whole-cube
  rotations and fixed-center frame semantics are not yet modeled;
- the 5x5x5 middle-edge projection is restricted to `A_12`;
- the 5x5x5 wing projection is restricted to `A_24`.

These produce structured `RestrictedPatternSolveError` codes such as
`unsupported-fixed-center-target` and `unsupported-orbit-subgroup`. They never
claim that the complete target is mathematically unreachable.

## Certified parity relations

The relations below are the exact `GF(2)` nullspaces of the physical piece
parities induced by every modeled quarter-turn generator. Deterministic random
full-sticker property tests additionally guard their implementation.

For the current 4x4x4 model:

```text
parity(center-0[24]) = parity(corner-0[8])
parity(edge-0[24 wing]) is independent
```

For the current all-slices 5x5x5 model, an independent basis is:

```text
parity(center-1[24]) xor parity(corner-0[8]) = 0
parity(center-0[6]) xor parity(center-1[24]) xor parity(edge-0[12]) = 0
parity(center-1[24]) xor parity(center-2[24]) xor parity(edge-1[24 wing]) = 0
```

These 5x5x5 relations must be regenerated if the move set is changed to fixed
centers.

## Reachability diagnostics

Diagnostics should distinguish at least:

1. malformed sticker or color inventory;
2. no compatible physical piece assignment;
3. invalid orientation invariant;
4. invalid global parity invariant;
5. valid state outside the currently implemented local subgroup;
6. missing generator certificate;
7. full-sticker verification failure.

## Unresolved odd-cube move-set decision

The current numeric move syntax denotes one layer at the requested depth. On
an odd cube this includes the exact central layer, so the present 5x5x5 model
allows moves such as single-layer `3F` and derives a six-piece fixed-center
orbit.

Before treating 5x5x5 parity relations as physical fixed-center cube results,
the project must choose one convention:

- an all-slices abstract puzzle in which central-slice/frame changes are part
  of the state; or
- a fixed-center cube in which the exact core layer is not an independent
  twist and whole-cube rotations are represented separately.

Parity coordination and the second 5x5x5 center primitive must not be finalized
until this move-set choice is explicit.
