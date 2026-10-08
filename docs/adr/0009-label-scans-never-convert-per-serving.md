# Label scans never convert per-serving values to per-100

A Label scan fills the per-100 nutrient fields, and suggests a Declared nutrition basis, only from a column the label itself heads "per 100 g" or "per 100 ml". When a label lists only per-serving values — for example "per serving (30 g): Protein 6.3 g" — the scan shows those values for reference but fills no per-100 field and sets no basis, leaving the user to enter per-100 values by hand. That is a worse experience on such labels, and it is deliberate.

Converting automatically (value × 100 ÷ serving weight) looks easy and was rejected for two reasons. First, labels round per-serving figures, and the conversion multiplies that rounding: "Protein <0.5 g" in a 15 g serving could mean anything from 0 to 3.3 g per 100 g, and a converted number would present that guess with false precision. Second, a Declared nutrition basis must be stated by the source and never synthesised from serving or package units (ADR 0007, CONTEXT.md); a label that lists only per-serving values has not stated a per-100 basis, and a silent conversion would record one as declared anyway.

## Considered Options

- **Automatic conversion when the serving weight is printed** — rejected for the reasons above.
- **An explicit "Convert from per serving (30 g)" action the user presses, with the arithmetic shown** — not in v1, but compatible with this decision as a later addition: the user, not the scan, would be making the conversion, and the result would be shown as converted rather than read.
