---
marp: true
theme: default
paginate: true
size: 16:9
---

# Demo: modality-ts で状態遷移バグを探す

通常のテストでは「その操作列を書いたか」に依存する<br>
modality-ts は「到達可能な状態空間」をまとめて検査する

---

## 今日見せるデモ

1. `examples/demo-app`
   - 二重 submit
   - guest の admin 到達
   - logout 後の SWR cache 残り

2. `examples/todo-app` / `examples/checkout-app`
   - stale completion
   - invalid quote から billing へ進める

3. 実運用アプリ `~/proj/gdgjp`
   - 実コードに当てたときに出た抽出器側のバグ/改善点

---

## 実行したコマンド

```bash
modality extract examples/demo-app/App.tsx \
  --out examples/demo-app/.modality-lt/model.json \
  --effect-api api.placeOrder

modality check examples/demo-app/.modality-lt/model.json \
  examples/demo-app/app.props.mjs \
  --report examples/demo-app/.modality-lt/report.json \
  --traces examples/demo-app/.modality-lt/traces
```

`extract -> check -> replay` の 3 段階

---

## Demo App: 3 件の違反

```text
noDoubleSubmit: violated
  App.onClick.api.placeOrder.start
  -> App.onClick.api.placeOrder.start

guestCannotReachAdmin: violated
  App.onClick.navigate._admin

guestDoesNotSeeUserCache: violated
  swr:api_user:fetch
  -> swr:api_user:resolve:success:0

states=1417 edges=6047 depth=12
```

---

## 反例 1: 二重 submit

プロパティ:

```js
state["sys:pending"]
  .filter((op) => op.opId === "api.placeOrder")
  .length <= 1
```

反例:

```text
Place order
-> まだ pending のまま
-> Place order
-> pending が 2 件
```

`modality replay` 結果: `replay: reproduced`

---

## 反例 2: Todo の stale completion

```text
staleCompletionIsInert: violated
  App.onClick.api.createTodo.start
  -> App.onClick.authAtom_draft_saveStatus.seq
  -> App.onChange.draft.nonEmpty
  -> App.onClick.api.createTodo.success

states=560 edges=3459 depth=12
```

「古い非同期完了が、現在の入力 draft を消してしまう」系のバグ

`modality replay` 結果: `replay: reproduced`

---

## 反例 3: Checkout の順序バグ

```text
invalidQuoteCannotEnterBilling: violated
  App.onClick.auth_userId.seq
  -> App.onClick.api.fetchQuote.start
  -> App.onClick.api.fetchQuote.success
  -> App.onClick.step.my8cwv

states=379 edges=2027 depth=12
```

「quote が invalid なのに billing に進める」<br>
UI の happy path テストだけだと落ちにくい

---

## gdgjp にも当てる

対象:

```bash
cd ~/proj/gdgjp
modality extract wiki/app/components/Navbar.tsx \
  --out wiki/.modality-lt-navbar/model.json
```

結果:

```text
extracted vars=5 transitions=6
plugins=router:router@0.1.0,state-source:use-state@0.1.0
```

実運用アプリの React component からもモデルを抽出できた

---

## gdgjp で見つかったもの

`Navbar.tsx` には複数の component-local `open` state がある

```text
local:UiLangSwitcher.open
local:UserMenu.open
local:NewPageDropdown.open
```

抽出モデルでは、`UiLangSwitcher` / `UserMenu` の click が<br>
`local:NewPageDropdown.open` を更新する transition として出ていた

```text
UiLangSwitcher.onClick.open -> writes local:NewPageDropdown.open
UserMenu.onClick.open       -> writes local:NewPageDropdown.open
```

これはアプリのバグではなく、実運用コードで見つかった抽出器側のバグ

---

## gdgjp check で止まった箇所

プロパティ:

```js
// 言語メニューを押しても New Page メニューは変わらないはず
step.transitionId !== "UiLangSwitcher.onClick.open" ||
post["local:NewPageDropdown.open"] === pre["local:NewPageDropdown.open"]
```

実行結果:

```text
Internal transitions did not stabilize within 16 steps
```

実アプリ投入で「状態名の衝突」と「internal transition の収束」の改善点が見えた

---

## デモで伝えたいこと

modality-ts は:

- 状態空間を探索して、書いていない操作列を見つける
- 反例を trace として残し、`replay` で再現確認できる
- example だけでなく、実運用アプリにも当てられる
- 実運用投入で、アプリのバグだけでなく抽出器の限界も早く見える

「テストを増やす」のではなく、<br>
「テストが見ていない状態遷移を機械に歩かせる」
