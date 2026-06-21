

<p align="center">
  <br>
  <br>
  <a href="https://modality-ts.yuni.cat" target="_blank" rel="noopener noreferrer">
    <img width="261" height="261" alt="icon-removebg-preview" src="https://github.com/user-attachments/assets/e698e5fd-3d41-4edf-9d32-ab72760cc4c9" />
  </a>
</p>

<h1 align="center">
modality-ts
</h1>
<p align="center">
React の状態遷移バグを対象とする、モデル検査ベースのテストツール。
<p>
<p align="center">
  <a href="https://www.npmjs.com/package/modality-ts">
  <img src="https://img.shields.io/npm/v/modality-ts.svg" alt="npm version">
</a>
<a href="https://github.com/Harineko0/modality-ts/actions/workflows/ci.yml">
  <img src="https://github.com/Harineko0/modality-ts/actions/workflows/ci.yml/badge.svg" alt="CI">
</a>
<a href="LICENSE">
  <img src="https://img.shields.io/badge/License-MIT-yellow.svg" alt="License: MIT">
</a>
<a href="https://www.typescriptlang.org/">
  <img src="https://img.shields.io/badge/TypeScript-5.9-blue.svg" alt="TypeScript">
</a>
<p>

<p align="center">
  <a href="README.md">English</a> | 日本語
</p>

### [ドキュメントを読む »](https://modality-ts.yuni.cat)

`modality-ts` は、React と TypeScript のコードから有限の遷移モデルを抽出します。
指定した範囲内で到達可能なすべての状態に対して、開発者が定義した**性質**を検査します。
そして反例が見つかれば、それを再生可能なテストへ変換します。

対象とするのは、入力例ごとのテストでは捉えにくいバグです。
二重送信、古い非同期処理が遅れて完了するケース、到達しないはずのチェックアウト状態、認証やルーターのバイパス、そして「これは決して起こらない」はずの状態の組み合わせ。
こうした不具合は、扱いにくいイベントの交錯が起きたあとにだけ現れることが多いものです。

## インストール

```bash
npm install -D modality-ts
# または
pnpm add -D modality-ts
# または
yarn add -D modality-ts
```

## 使い方

### 1. 空の props ファイルを作る

モデル化したいコンポーネントの隣に、空の `*.props.ts` ファイルを作ります。

```text
src/App.tsx
src/App.props.ts
```

### 2. 生成を実行する

性質を書く前に、生成を実行します。

```bash
npx modality init
npx modality generate
```

これにより、`src/App.modals.ts` のような兄弟モジュールが書き出されます。
このモジュールには、コンポーネントの状態と遷移を指す型付きのハンドルが含まれます。

### 3. 性質を書く

props ファイルに性質を書きます。
コンポーネントのハンドルは、`./App.modals` のような兄弟モジュールからインポートします。

```ts
// src/App.props.ts
import {
  always,
  alwaysStep,
  and,
  eq,
  leadsToWithin,
  not,
  or,
  reachable,
  reachableFrom,
  stepEnqueued,
} from "modality-ts/properties";
import { App } from "./App.modals";

// always は状態不変条件に使う
always(
  "guestCannotReachSuccess",
  not(and(eq(App.auth, "guest"), eq(App.step, "success"))),
);

// alwaysStep はアクションの規則に使う
alwaysStep("emptyDraftCannotSubmit", {
  negate: true,
  step: stepEnqueued("api.createTodo"),
  pre: eq(App.draft, "empty"),
});

// reachable は健全性の確認に使う
reachable("successIsReachable", eq(App.step, "success"));

// reachableFrom は条件付きの到達可能性に使う
reachableFrom(
  "reviewStaysReachable",
  eq(App.payment, "valid"),
  eq(App.step, "review"),
);

// leadsToWithin は有界の応答性に使う
leadsToWithin(
  "submitResolves",
  stepEnqueued("api.placeOrder"),
  or(eq(App.order, "success"), eq(App.order, "error")),
  { budget: { environment: 3 } },
);
```

### 4. 抽出して検査する

抽出と検査を実行します。

```bash
# ソースコードからモデルを抽出する
npx modality extract

# モデルに対して性質を検査する
npx modality check
```

次のようなレポートが出力されます。

```text
 ✓ src/App.props.ts 0.13s
  (2 tests, 2 passed, 0 failed, 0 errors, states 1, edges 0, depth 1, slices 2, vars 2, transitions 0, skipped 0)
  ✓ guestCannotReachSuccess reachable
    trace: (initial)
  ✓ emptyDraftCannotSubmit verified-within-bounds
    trace: (initial)
  ✓ guestCannotReachSuccess verified-within-bounds
    trace: (initial)
  ✓ reviewStaysReachable verified-within-bounds
    trace: (initial)
  ✓ submitResolves verified-within-bounds
    trace: (initial)

 Test Files  0 failed | 1 passed (5)
      Tests  5 passed, 0 failed, 0 warnings, (5)
   Start at  <timestamp>
   Duration  <duration>
```

## 適用範囲

`modality-ts` が検証するのは、抽出できたモデルであって、ブラウザの任意の挙動ではありません。
重要な振る舞いが、TypeScript 上の有界で決定的な状態遷移として表現されている React アプリで最もよく働きます。

うまく合うのは、次のような対象です。

- ローカルな `useState` の遷移を持つコンポーネント。
- Jotai、SWR、ルーターの状態など、サポートされている状態およびデータソースを使うアプリ。
- 有限のドメイン、有界なコレクション、名前付きの副作用からなるフロー。
- 到達可能な状態についての安全性の性質として表現できる業務ルール。

いまのところ合いにくいのは、次のような対象です。

- 正しさが主に DOM のレイアウト、CSS、アニメーションのタイミング、canvas の描画、ブラウザの癖に依存するアプリ。
- 明示的な有限の境界を持たない、非有界または数値中心の振る舞い。
- 副作用や有界なデータとしてモデル化されていない外部サービス。
- 抽出されたモデルに表現されていない並行処理、タイマー、ネットワークの競合。
- サポートされている React と TypeScript の抽出サブセットの外にあるコードパターン。

これらの場合は、通常の単体テスト、結合テスト、エンドツーエンドテストと併用してください。

## ライセンス

MIT
