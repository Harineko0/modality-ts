import { useState } from "react";
import { atom, useSetAtom } from "jotai";
import useSWR from "swr";

export const authAtom = atom<"guest" | "user">("guest");
type UserData = "alice" | "bob";

export function App() {
  const [orderStatus, setOrderStatus] = useState<
    "idle" | "submitting" | "done"
  >("idle");
  const setAuth = useSetAtom(authAtom);
  const { data } = useSWR<UserData>("/api/user", fetchUser);

  return (
    <main>
      <button type="button" onClick={() => setAuth("user")}>
        Login
      </button>
      <button type="button" onClick={() => navigate("/admin")}>
        Admin
      </button>
      <button type="button" onClick={() => setAuth("guest")}>
        Logout
      </button>
      <button
        type="button"
        onClick={async () => {
          setOrderStatus("submitting");
          await api.placeOrder();
          setOrderStatus("done");
        }}
      >
        Place order
      </button>
      <output>{orderStatus}</output>
      <output>{data}</output>
    </main>
  );
}
