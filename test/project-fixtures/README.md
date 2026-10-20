# Project import regression fixtures

`edited-component-source-draft.usp` is a synthetic three-link robot project saved
through the editor before the project source roundtrip fix. It contains no account
data, credentials, remote assets, or user robot designs.

The fixture retains the original canonical workspace, editing history, and owned
URDF draft. The added link and joint have stable IDs different from their display
names; its cylinder also retains an unused dimension, and parsing the generated
URDF creates material annotations and updated inspection counts. Reopening this
unchanged archive previously failed with a component source draft content hash
mismatch.

Keep the fixture unchanged so the import test covers already-saved projects, not
only files produced by the current exporter.
