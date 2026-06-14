# Coarse Token Domains Limit Semantic Properties

## Summary

Several extracted domains in the TinyURL app were represented as generic tokens such as `"tok1"` or length categories. This keeps extraction finite, but it prevents properties from checking meaningful string semantics.

## Why This Matters

Important TinyURL behavior depends on values like URL validity, slug validity, visibility, tag names, and selected tab keys. If these values are tokenized too coarsely, properties can only check shape-level invariants, not the user-visible semantics that are likely to contain hidden bugs.

## Reproduction

```bash
cd /Users/hari/proj/gdgjp/tinyurl
rtk pnpm exec modality extract
rtk node -e 'const fs=require("fs"); const m=JSON.parse(fs.readFileSync(".modality/model.json","utf8")); for (const v of m.vars) console.log(v.id, JSON.stringify(v.domain), "initial=", JSON.stringify(v.initial));'
```

Representative coarse domains observed:

```text
local:TabbedBarCard.active {"count":1,"kind":"tokens"} initial= "tok1"
local:TagCombobox.activeIndex {"count":1,"kind":"tokens"} initial= "tok1"
local:Calendar.anchor {"count":1,"kind":"tokens"} initial= "tok1"
local:ShareForm.chapterId {"count":1,"kind":"tokens"} initial= "tok1"
local:EditLink.draft {"kind":"record", ... "visibility":{"count":1,"kind":"tokens"} ...} initial= {"visibility":"tok1", ...}
local:CreateLinkForm.tagIds {"kind":"lengthCat"} initial= "0"
local:CreateLinkForm.newTagNames {"kind":"lengthCat"} initial= "0"
```

This made an intended property such as "edit draft visibility stays private or public" fail to be meaningful, because `local:EditLink.draft.visibility` was modeled as `"tok1"` rather than `"private" | "public"`.

## Expected Behavior

When TypeScript types or nearby code expose finite string unions, extraction should preserve those literal domains where practical. For unknown strings, users should have an easy overlay mechanism to refine domains with representative values.

## Observed Behavior

Some values with app-level finite meaning were abstracted as generic tokens. Properties over those fields either become impossible or produce false failures.

## Possible Fix Directions

- Preserve literal union types inside records when they are available.
- Infer finite domains from `SelectItem value=...`, validation branches, and `as const` arrays.
- Let props files or config files refine variable domains without editing app code.
- Add warnings when a property reads a tokenized field, especially nested record fields.
- Emit suggested overlays for common UI patterns such as select values and tab keys.
