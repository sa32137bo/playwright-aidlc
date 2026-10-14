# CHK-42 — Guest checkout with saved address

> Sample story for trying the kit. Drop a file like this into `inputs/stories/`
> when you are not connecting Jira. The filename stem becomes the bolt ID.

**Type:** Story
**Epic:** Checkout modernisation
**Status:** Ready for Dev

## Description

Returning customers who have not signed in should still be able to check out.
When they enter an email we recognise, we offer the addresses already on file so
they do not retype them. Postcode must be validated before the order is
submitted, because our fulfilment partner rejects malformed addresses and we
absorb the cost of the failed delivery.

## Acceptance criteria

1. A guest with items in the cart can reach checkout without signing in.
2. Entering a recognised email shows the saved addresses in a picker, and
   selecting one fills the address fields.
3. An invalid postcode blocks submission and shows a message next to the field.
4. On success the confirmation page shows the order number.

## Out of scope

- Payment authorisation (separate epic)
- Address editing (CHK-51)

## Notes from refinement

- The `new_checkout` feature flag must be on. With it off, checkout redirects to sign-in.
- Test account `returning@example.com` has 2 saved addresses in staging.
