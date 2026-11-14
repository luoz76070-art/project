# material-color-utilities (subset)

Unmodified files from `@material/material-color-utilities` 0.4.0 (Apache-2.0, see
`LICENSE`), npm integrity
`sha512-dlq6VExJReb8dhjj3a/yTigr3ncNwoFmL5Iy2ENtbDX03EmNeOEdZ+vsaGrj7RTuO+mB7L58II4LCsl4NpM8uw==`.

Only `Blend.harmonize` and the HCT code it needs are kept. The phone app uses
them to harmonize the error colour with the system's dynamic primary colour,
the same step Flutter's `dynamic_color` (`ColorScheme.harmonized`) performed in
the former Kelivo host.
