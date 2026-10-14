# Business Requirements — Checkout (extract)

> Sample requirements doc. Drop files like this into `inputs/requirements/`.
> The agent reads only what relates to the bolt's scope.

## 4.2 Address validation

Malformed addresses cost the business roughly £11 per failed delivery, so
validation happens client-side before submission rather than only at the
fulfilment API.

- **4.2.1** Postcode is mandatory for all countries.
- **4.2.2** Postcode format is validated against the selected country.
- **4.2.3** Postcode length must not exceed the carrier limit.
- **4.2.4** Validation failures must identify the specific field, not show a
  generic form-level error. Support tickets showed customers abandoning when
  told only that "something is wrong".

## 4.5 Guest identification

- **4.5.1** Address lookup by email must not confirm whether an account exists —
  an unrecognised email shows no message at all, by design. This is an account
  enumeration control, not an oversight.

## 6.1 Order confirmation

- **6.1.1** Confirmation must display the order reference in the format ORD-nnnnnn.
- **6.1.2** The cart must be emptied on successful submission.
