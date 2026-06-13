# modality-ts Demo App

This fixture is the MVP acceptance surface from `docs/design.md` in executable form.

It intentionally contains three modeled state-transition bugs:

- `noDoubleSubmit`: the order button can enqueue two `api.placeOrder` requests.
- `guestCannotReachAdmin`: the app can be on `/admin` while `authAtom` is `guest`.
- `guestDoesNotSeeUserCache`: the SWR user cache can contain data while auth is `guest`.

The repo test suite runs this fixture through `modality extract` and `modality check`.
