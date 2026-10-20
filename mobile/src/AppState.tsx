import { router, usePathname, type Href } from "expo-router";
import React, {
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import {
  ActivityIndicator,
  Alert,
  AppState as NativeAppState,
  Dimensions,
  Image,
  KeyboardAvoidingView,
  Linking,
  Platform,
  Pressable,
  ScrollView,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import * as ImagePicker from "expo-image-picker";
import * as WebBrowser from "expo-web-browser";
import * as Clipboard from "expo-clipboard";

import {
  API,
  api,
  clearSession,
  naira,
  recentOrders,
  rememberOrder,
  restoreSession,
  saveSession,
  statusLabel,
  toKobo,
  upload,
} from "./api";

import { Button, Card, Field, Toggle, s, c } from "./ui";
import HowItWorks from "./HowItWorks";
import type { Shopper, Order } from "./types";

type Screen =
  | "home"
  | "shoppers"
  | "create"
  | "track"
  | "login"
  | "register"
  | "dashboard"
  | "shopperOrder"
  | "settings"
  | "terms";

const marketImages = [
  require("../assets/market-1.png"),
  require("../assets/market-2.png"),
  require("../assets/market-3.png"),
  require("../assets/market-4.png"),
];

const labels = [
  "Fresh produce",
  "Clothing & textiles",
  "Grains & provisions",
  "Fruit & household goods",
];

function paymentLog(
  message: string,
  details?: Record<string, unknown>,
) {
  if (__DEV__) {
    console.log(`[PAYMENT] ${message}`, details ?? "");
  }
}

function Carousel() {
  const width = Dimensions.get("window").width - 44;
  const ref = useRef<ScrollView>(null);
  const [index, setIndex] = useState(0);

  useEffect(() => {
    const timer = setInterval(() => {
      setIndex(
        (previous) => (previous + 1) % marketImages.length,
      );
    }, 3500);

    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    ref.current?.scrollTo({
      x: index * width,
      animated: true,
    });
  }, [index, width]);

  return (
    <View>
      <ScrollView
        horizontal
        pagingEnabled
        ref={ref}
        showsHorizontalScrollIndicator={false}
        onMomentumScrollEnd={(event) =>
          setIndex(
            Math.round(
              event.nativeEvent.contentOffset.x / width,
            ),
          )
        }
      >
        {marketImages.map((image, i) => (
          <View key={i} style={{ width }}>
            <Image
              source={image}
              accessibilityLabel={
                labels[i] + " market illustration"
              }
              style={{
                width,
                height: 205,
                borderRadius: 20,
              }}
            />
            <Text style={[s.small, { marginTop: 8 }]}>
              {labels[i]} · Illustrative market scene
            </Text>
          </View>
        ))}
      </ScrollView>
    </View>
  );
}

const ScreenContext =
  React.createContext<React.ReactNode>(null);

export function AppStateProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname();

  const screen = (
    pathname === "/" ? "home" : pathname.slice(1)
  ) as Screen;

  const [hasSession, setHasSession] = useState(false);
  const [forgot, setForgot] = useState(false);
  const [resetCode, setResetCode] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const [selected, setSelected] =
    useState<Shopper | null>(null);
  const [key, setKey] = useState("");
  const [order, setOrder] = useState<Order | null>(null);
  const [me, setMe] = useState<Shopper | null>(null);

  const [shoppers, setShoppers] = useState<Shopper[]>([]);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);

  const [myOrders, setMyOrders] = useState<Order[]>([]);
  const [myPage, setMyPage] = useState(1);
  const [myTotal, setMyTotal] = useState(0);

  const [announcements, setAnnouncements] = useState<
    { _id: string; title: string; body: string }[]
  >([]);

  const [platformFee, setPlatformFee] = useState(0);
  const [recent, setRecent] = useState<string[]>([]);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  const [customer, setCustomer] = useState({
    name: "",
    email: "",
    phone: "",
    address: "",
  });

  const [items, setItems] = useState<
    {
      name: string;
      quantity: string;
      unit: string;
      price: string;
    }[]
  >([
    {
      name: "",
      quantity: "1",
      unit: "item",
      price: "",
    },
  ]);

  const [market, setMarket] = useState("");
  const [notes, setNotes] = useState("");
  const [prices, setPrices] = useState<string[]>([]);
  const [transport, setTransport] = useState("");
  const [fee, setFee] = useState("");
  const [reason, setReason] = useState("");

  const [complaint, setComplaint] = useState({
    subject: "",
    message: "",
  });

  const [earnings, setEarnings] = useState({
    orders: 0,
    settlementTotal: 0,
    shoppingEarnings: 0,
    cleared: 0,
    pending: 0,
  });

  const [tab, setTab] = useState("Orders");

  const [reg, setReg] = useState({
    surname: "",
    firstName: "",
    otherNames: "",
    email: "",
    password: "",
    phone: "",
    address: "",
    residence: "",
    state: "",
    markets: "",
    ownsBusiness: false,
    products: "",
    willing: true,
    providesId: true,
    mobile: false,
    shoppingFee: "",
    profilePhoto: "",
    identityFile: "",
  });

  const [states, setStates] = useState<string[]>([]);
  const [showStates, setShowStates] = useState(false);

  const [banks, setBanks] = useState<
    { name: string; code: string }[]
  >([]);

  const [bankCode, setBankCode] = useState("");
  const [bankSearch, setBankSearch] = useState("");
  const [accountNumber, setAccountNumber] = useState("");
  const [accountName, setAccountName] = useState("");
  const [settingsFee, setSettingsFee] = useState("");
  const [newPhoto, setNewPhoto] = useState("");
  const [otp, setOtp] = useState("");
  const [otpSent, setOtpSent] = useState(false);

  function setScreen(next: Screen) {
    if (next === screen) return;

    const path = (
      next === "home" ? "/" : "/" + next
    ) as Href;

    if (next === "home") {
      router.replace(path);
    } else {
      router.push(path);
    }
  }

  async function run(task: () => Promise<void>) {
    setBusy(true);
    setError("");

    try {
      await task();
    } catch (error) {
      setError(
        error instanceof Error
          ? error.message
          : "Something went wrong.",
      );
    } finally {
      setBusy(false);
    }
  }

  function go(next: Screen) {
    setScreen(next);
    setError("");
    setReason("");
  }

  async function dashboard(p = myPage) {
    const [user, orders, news, platform, totals] =
      await Promise.all([
        api<Shopper>("/me"),
        api<{ records: Order[]; total: number }>(
          `/me/orders?page=${p}`,
        ),
        api<typeof announcements>("/announcements"),
        api<{ platformFee: number }>("/me/platform"),
        api<typeof earnings>("/me/earnings"),
      ]);

    setMe(user);
    setMyOrders(orders.records);
    setMyTotal(orders.total);
    setMyPage(p);
    setAnnouncements(news);
    setPlatformFee(platform.platformFee);
    setEarnings(totals);

    go("dashboard");
  }

  async function list(p = 1) {
    const data = await api<{
      records: Shopper[];
      total: number;
    }>(`/shoppers?page=${p}`);

    setShoppers(data.records);
    setTotal(data.total);
    setPage(p);

    go("shoppers");
  }

  async function track(value = key) {
    const normalizedKey = value.trim().toUpperCase();

    const data = await api<Order>(
      "/order",
      "GET",
      undefined,
      normalizedKey,
    );

    setKey(normalizedKey);
    setOrder(data);

    await rememberOrder(normalizedKey);
    setRecent(await recentOrders());

    go("track");
  }

  const refreshTracked = useCallback(async () => {
    setOrder(
      await api<Order>(
        "/order",
        "GET",
        undefined,
        key,
      ),
    );
  }, [key]);

  useEffect(() => {
    void recentOrders()
      .then(setRecent)
      .catch(() => setRecent([]));

    void restoreSession()
      .then(setHasSession)
      .catch(() => setHasSession(false));
  }, []);

  useEffect(() => {
    if (__DEV__) {
      console.log(
        "[APP LIFECYCLE] Provider mounted",
        NativeAppState.currentState,
      );
    }

    const subscription = NativeAppState.addEventListener(
      "change",
      (state) => {
        if (__DEV__) {
          console.log("[APP LIFECYCLE]", state);
        }
      },
    );

    return () => subscription.remove();
  }, []);

  useEffect(() => {
    if (screen !== "track") return;

    const timer = setInterval(() => {
      void refreshTracked().catch(() => {});
    }, 30000);

    return () => clearInterval(timer);
  }, [screen, refreshTracked]);

  function editItem(
    index: number,
    field: "name" | "quantity" | "unit" | "price",
    value: string,
  ) {
    setItems((previous) =>
      previous.map((item, i) =>
        i === index
          ? { ...item, [field]: value }
          : item,
      ),
    );
  }

  async function photo(callback: (id: string) => void) {
    const permission =
      await ImagePicker.requestMediaLibraryPermissionsAsync();

    if (!permission.granted) {
      throw new Error(
        "Photo permission is required to select an image.",
      );
    }

    const result =
      await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ["images"],
        quality: 0.8,
        allowsEditing: true,
        aspect: [1, 1],
      });

    if (result.canceled) return;

    const image = result.assets[0];

    if (!image?.uri) {
      throw new Error(
        "No photo was selected. Please select your picture again.",
      );
    }

    const fileId = await upload(
      image.uri,
      image.fileName || "profile.jpg",
      image.mimeType || "image/jpeg",
      "photo",
    );

    callback(fileId);
  }

  async function identity() {
    const permission =
      await ImagePicker.requestMediaLibraryPermissionsAsync();

    if (!permission.granted) {
      throw new Error(
        "Photo permission is required to select your ID image.",
      );
    }

    const result =
      await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ["images"],
        quality: 0.8,
        allowsEditing: false,
      });

    if (result.canceled) return;

    const image = result.assets[0];

    if (!image?.uri) {
      throw new Error(
        "Please select a clear image of your ID.",
      );
    }

    const fileId = await upload(
      image.uri,
      image.fileName || "identity.jpg",
      image.mimeType || "image/jpeg",
      "identity",
    );

    setReg((previous) => ({
      ...previous,
      identityFile: fileId,
    }));
  }

  async function payWithPaystack() {
    const startedAt = Date.now();
    let stage = "Starting";

    try {
      paymentLog("1. Payment button pressed", {
        status: order?.status,
        hasOrderKey: Boolean(key),
      });

      if (!key.trim()) {
        throw new Error(
          "Your order ID is missing. Open your order again.",
        );
      }

      stage = "Requesting checkout";
      paymentLog("2. Requesting checkout from API");

      const data = await api<{ url: string }>(
        "/order/pay",
        "POST",
        {},
        key,
      );

      paymentLog("3. Checkout response received", {
        hasUrl:
          typeof data.url === "string" &&
          data.url.length > 0,
        elapsedMs: Date.now() - startedAt,
      });

      stage = "Validating checkout URL";

      if (typeof data.url !== "string" || !data.url) {
        throw new Error(
          "The server returned no payment URL.",
        );
      }

      const checkoutUrl = new URL(data.url);

      if (checkoutUrl.protocol !== "https:") {
        throw new Error(
          "The checkout URL must use HTTPS.",
        );
      }

      paymentLog("4. Checkout URL validated", {
        host: checkoutUrl.hostname,
      });

      stage = "Opening checkout browser";

      paymentLog("5. Opening checkout", {
        browser:
          Platform.OS === "android"
            ? "com.android.chrome"
            : "system browser",
      });

      const result = await WebBrowser.openBrowserAsync(
        data.url,
        Platform.OS === "android"
          ? { browserPackage: "com.android.chrome" }
          : {},
      );

      paymentLog("6. Browser launch returned", {
        type: result.type,
      });

      // Browser launch does not confirm payment.
      // The customer returns and taps Check payment.
    } catch (error) {
      if (__DEV__) {
        console.error("[PAYMENT] Failed", {
          stage,
          message:
            error instanceof Error
              ? error.message
              : String(error),
        });
      }

      if (
        stage === "Opening checkout browser" &&
        Platform.OS === "android"
      ) {
        throw new Error(
          "Could not open checkout in Chrome. Make sure Chrome is installed, enabled, and opens normally on your phone.",
        );
      }

      throw error;
    }
  }

  async function checkPayment() {
    try {
      paymentLog("7. Checking payment with API");

      const result = await api<{ paid: boolean }>(
        "/order/verify-payment",
        "POST",
        {},
        key,
      );

      paymentLog("8. Verification returned", {
        paid: result.paid,
      });

      await refreshTracked();
      paymentLog("9. Order refreshed");

      Alert.alert(
        result.paid
          ? "Payment confirmed"
          : "Payment not confirmed yet",
        result.paid
          ? "Your payment has been verified successfully."
          : "If you completed payment, wait briefly and check again. Do not pay again yet.",
      );
    } catch (error) {
      if (__DEV__) {
        console.error("[PAYMENT] Verification failed", {
          message:
            error instanceof Error
              ? error.message
              : String(error),
        });
      }

      throw error;
    }
  }

  async function settings() {
    if (!me) return;

    setSettingsFee(String(me.shoppingFee / 100));
    setNewPhoto("");
    setOtpSent(false);
    setOtp("");
    setBankCode("");
    setBankSearch("");
    setAccountNumber("");
    setAccountName("");

    go("settings");

    try {
      setBanks(await api<typeof banks>("/banks"));
    } catch (error) {
      setError(
        error instanceof Error
          ? error.message
          : "Banks unavailable.",
      );
    }
  }

  function back() {
    setError("");

    if (router.canGoBack()) {
      router.back();
    } else {
      router.replace("/");
    }
  }

  return (
    <ScreenContext.Provider
      value={
        <SafeAreaView style={s.screen}>
          <KeyboardAvoidingView
            style={{ flex: 1 }}
            behavior={
              Platform.OS === "ios"
                ? "padding"
                : undefined
            }
          >
            <View style={s.header}>
              <Pressable onPress={() => go("home")}>
                <Text style={s.brand}>
                  loRan{" "}
                  <Text style={{ color: c.orange }}>
                    Shopper
                  </Text>
                </Text>
              </Pressable>

              {screen !== "home" && (
                <Pressable onPress={back}>
                  <Text style={s.link}>Back</Text>
                </Pressable>
              )}
            </View>

            <ScrollView
              keyboardShouldPersistTaps="handled"
              contentContainerStyle={s.content}
            >
              {error !== "" && (
                <Text
                  accessibilityRole="alert"
                  style={s.error}
                >
                  {error}
                </Text>
              )}

              {busy && (
                <ActivityIndicator color={c.green} />
              )}

              {screen === "home" && (
                <>
                  <Text style={s.badge}>
                    LOCAL MARKETS. LESS HASSLE.
                  </Text>

                  <Text style={s.h1}>
                    Your market trip,
                    <Text style={{ color: c.orange }}>
                      {" "}handled.
                    </Text>
                  </Text>

                  <Text
                    style={[s.text, { marginBottom: 20 }]}
                  >
                    Meet local shoppers who buy from Nigerian
                    markets and deliver to your doorstep.
                    Choose a shopper, send your list and
                    approve a clear quote before you pay.
                  </Text>

                  <Carousel />

                  <HowItWorks />

                  <Button
                    title="Find a shopper"
                    disabled={busy}
                    onPress={() => run(() => list())}
                  />

                  <Card>
                    <Text style={s.h2}>
                      Track your order
                    </Text>

                    <Text style={s.small}>
                      Your private order ID opens your order.
                      Keep it safe.
                    </Text>

                    <Field
                      label="Order ID"
                      value={key}
                      onChangeText={setKey}
                      autoCapitalize="characters"
                    />

                    <Button
                      title="Open my order"
                      disabled={busy || !key}
                      onPress={() => run(() => track())}
                    />

                    {recent.map((value) => (
                      <Pressable
                        key={value}
                        onPress={() =>
                          run(() => track(value))
                        }
                      >
                        <Text style={s.link}>
                          Recent: {value.slice(0, 15)}…
                        </Text>
                      </Pressable>
                    ))}
                  </Card>

                  <Card>
                    <Text style={s.h2}>
                      Know your local markets?
                    </Text>

                    <Text style={s.text}>
                      Help customers shop nearby and earn a
                      shopping fee. Owning a business or a
                      vehicle is optional.
                    </Text>

                    <Button
                      title="Apply as a shopper"
                      secondary
                      disabled={busy}
                      onPress={() =>
                        run(async () => {
                          setStates(
                            await api<string[]>("/states"),
                          );
                          go("register");
                        })
                      }
                    />

                    <Button
                      title={
                        hasSession
                          ? "Shopper dashboard"
                          : "Shopper login"
                      }
                      secondary
                      disabled={busy}
                      onPress={() =>
                        hasSession
                          ? run(() => dashboard())
                          : go("login")
                      }
                    />
                  </Card>

                  <Pressable
                    onPress={() => go("terms")}
                  >
                    <Text style={s.link}>
                      Terms, complaints & privacy
                    </Text>
                  </Pressable>
                </>
              )}

              {screen === "shoppers" && (
                <>
                  <Text style={s.h1}>
                    Available shoppers
                  </Text>

                  <Text style={s.text}>
                    Only approved shoppers who are currently
                    available appear here.
                  </Text>

                  {shoppers.map((shopper) => (
                    <Card key={shopper._id}>
                      <View style={s.row}>
                        <Image
                          source={{
                            uri:
                              API +
                              "/v1/photos/" +
                              shopper.profilePhoto,
                          }}
                          style={s.photo}
                        />

                        <View style={{ flex: 1 }}>
                          <Text style={s.h3}>
                            {shopper.firstName}{" "}
                            {shopper.surname}
                          </Text>
                          <Text style={s.small}>
                            {shopper.state}
                          </Text>
                        </View>
                      </View>

                      <Text style={s.text}>
                        {shopper.markets.join(" · ")}
                      </Text>

                      <Text style={s.small}>
                        Shopping price
                      </Text>

                      <Text style={s.price}>
                        {naira(shopper.shoppingFee)}
                      </Text>

                      <Text style={s.small}>
                        Items and transport are quoted
                        separately.
                      </Text>

                      <Button
                        title="Choose this shopper"
                        onPress={() => {
                          setSelected(shopper);
                          setMarket(shopper.markets[0]);
                          go("create");
                        }}
                      />
                    </Card>
                  ))}

                  {!shoppers.length && (
                    <Text style={s.text}>
                      No shoppers are available right now.
                      Please check again later.
                    </Text>
                  )}

                  <View style={s.row}>
                    <Button
                      title="Previous"
                      secondary
                      disabled={page === 1 || busy}
                      onPress={() =>
                        run(() => list(page - 1))
                      }
                    />
                    <Text>{page}</Text>
                    <Button
                      title="Next"
                      secondary
                      disabled={
                        page * 20 >= total || busy
                      }
                      onPress={() =>
                        run(() => list(page + 1))
                      }
                    />
                  </View>
                </>
              )}

              {screen === "create" && selected && (
                <>
                  <Text style={s.h1}>
                    Write your shopping list
                  </Text>

                  <Text style={s.text}>
                    For {selected.firstName}. Choose a
                    covered market:
                  </Text>

                  {selected.markets.map((value) => (
                    <Button
                      key={value}
                      title={
                        (market === value ? "✓ " : "") +
                        value
                      }
                      secondary
                      onPress={() => setMarket(value)}
                    />
                  ))}

                  <Field
                    label="Your full name"
                    value={customer.name}
                    onChangeText={(value) =>
                      setCustomer((previous) => ({
                        ...previous,
                        name: value,
                      }))
                    }
                  />

                  <Field
                    label="Email for quotes and your order ID"
                    keyboardType="email-address"
                    autoCapitalize="none"
                    value={customer.email}
                    onChangeText={(value) =>
                      setCustomer((previous) => ({
                        ...previous,
                        email: value,
                      }))
                    }
                  />

                  <Field
                    label="WhatsApp number (+234…)"
                    keyboardType="phone-pad"
                    value={customer.phone}
                    onChangeText={(value) =>
                      setCustomer((previous) => ({
                        ...previous,
                        phone: value,
                      }))
                    }
                  />

                  <Field
                    label="Delivery address / location"
                    multiline
                    value={customer.address}
                    onChangeText={(value) =>
                      setCustomer((previous) => ({
                        ...previous,
                        address: value,
                      }))
                    }
                  />

                  {items.map((item, i) => (
                    <Card key={i}>
                      <Text style={s.h3}>
                        Item {i + 1}
                      </Text>

                      <Field
                        label="Item name"
                        value={item.name}
                        onChangeText={(value) =>
                          editItem(i, "name", value)
                        }
                      />

                      <View style={s.row}>
                        <View style={{ flex: 1 }}>
                          <Field
                            label="Quantity"
                            keyboardType="decimal-pad"
                            value={item.quantity}
                            onChangeText={(value) =>
                              editItem(
                                i,
                                "quantity",
                                value,
                              )
                            }
                          />
                        </View>

                        <View style={{ flex: 1 }}>
                          <Field
                            label="Unit (kg, bag, item…)"
                            value={item.unit}
                            onChangeText={(value) =>
                              editItem(i, "unit", value)
                            }
                          />
                        </View>
                      </View>

                      <Field
                        label="Estimated price per unit, ₦ (leave blank if unknown)"
                        keyboardType="decimal-pad"
                        value={item.price}
                        onChangeText={(value) =>
                          editItem(i, "price", value)
                        }
                      />

                      {items.length > 1 && (
                        <Button
                          title="Remove item"
                          secondary
                          onPress={() =>
                            setItems((previous) =>
                              previous.filter(
                                (_, index) => index !== i,
                              ),
                            )
                          }
                        />
                      )}
                    </Card>
                  ))}

                  <Button
                    title="+ Add item"
                    secondary
                    onPress={() =>
                      setItems((previous) => [
                        ...previous,
                        {
                          name: "",
                          quantity: "1",
                          unit: "item",
                          price: "",
                        },
                      ])
                    }
                  />

                  <Field
                    label="Notes / substitutions"
                    multiline
                    value={notes}
                    onChangeText={setNotes}
                  />

                  <Text style={s.small}>
                    Submitting agrees to our terms.
                    Complaints must be filed within 24 hours
                    after the order is marked delivered.
                  </Text>

                  <Button
                    title="Submit order"
                    disabled={busy}
                    onPress={() =>
                      run(async () => {
                        const data = await api<{
                          orderKey: string;
                        }>("/orders", "POST", {
                          shopperId: selected._id,
                          market,
                          customer,
                          items: items.map((item) => ({
                            name: item.name,
                            quantity: Number(
                              item.quantity,
                            ),
                            unit: item.unit,
                            estimatedUnitPrice:
                              item.price
                                ? toKobo(item.price)
                                : null,
                          })),
                          notes,
                        });

                        setKey(data.orderKey);
                        await track(data.orderKey);
                      })
                    }
                  />
                </>
              )}

              {screen === "track" && order && (
                <>
                  <Text style={s.h1}>
                    Your order
                  </Text>

                  <Text selectable style={s.code}>
                    {key}
                  </Text>

                  <Button
                    title="Copy private order ID"
                    secondary
                    onPress={() =>
                      run(async () => {
                        await Clipboard.setStringAsync(key);
                        Alert.alert(
                          "Copied",
                          "Keep this ID private.",
                        );
                      })
                    }
                  />

                  <Text
                    style={[
                      s.badge,
                      { marginTop: 15 },
                    ]}
                  >
                    {statusLabel(order.status)}
                  </Text>

                  <Button
                    title="Refresh progress"
                    secondary
                    disabled={busy}
                    onPress={() => run(refreshTracked)}
                  />

                  <OrderDetails order={order} />

                  {order.status === "quoted" && (
                    <Card>
                      <Text style={s.h2}>
                        Your quote is ready
                      </Text>

                      <Button
                        title="Accept quote"
                        disabled={busy}
                        onPress={() =>
                          run(async () => {
                            await api(
                              "/order/quote-decision",
                              "POST",
                              {
                                accept: true,
                                revision:
                                  order.quoteRevision,
                                reason: "",
                              },
                              key,
                            );

                            await refreshTracked();
                          })
                        }
                      />

                      <Field
                        label="Reason for rejecting"
                        multiline
                        value={reason}
                        onChangeText={setReason}
                      />

                      <Button
                        title="Reject quote"
                        secondary
                        disabled={busy || !reason}
                        onPress={() =>
                          run(async () => {
                            await api(
                              "/order/quote-decision",
                              "POST",
                              {
                                accept: false,
                                revision:
                                  order.quoteRevision,
                                reason,
                              },
                              key,
                            );

                            await refreshTracked();
                          })
                        }
                      />
                    </Card>
                  )}

                  {order.status === "accepted" && (
                    <Card>
                      <Text style={s.h2}>
                        Pay securely
                      </Text>

                      <Text style={s.small}>
                        Complete payment in your browser,
                        return to this order, and tap
                        Check payment.
                      </Text>

                      <Button
                        title="Pay with Paystack"
                        disabled={busy}
                        onPress={() =>
                          run(payWithPaystack)
                        }
                      />

                      <Button
                        title="Check payment"
                        secondary
                        disabled={busy}
                        onPress={() => run(checkPayment)}
                      />
                    </Card>
                  )}

                  {order.status === "delivered" && (
                    <Card>
                      <Text style={s.h2}>
                        Delivery & complaints
                      </Text>

                      <Text style={s.text}>
                        File a complaint within 24 hours
                        after the delivered timestamp.
                        Deadline:{" "}
                        {order.complaintDeadline
                          ? new Date(
                              order.complaintDeadline,
                            ).toLocaleString()
                          : "Check order details"}
                        .
                      </Text>

                      <Button
                        title={
                          order.customerConfirmedAt
                            ? "Delivery confirmed"
                            : "Confirm I received my order"
                        }
                        secondary
                        disabled={
                          busy ||
                          !!order.customerConfirmedAt
                        }
                        onPress={() =>
                          run(async () => {
                            await api(
                              "/order/confirm-delivery",
                              "POST",
                              {},
                              key,
                            );

                            await refreshTracked();
                          })
                        }
                      />

                      <Field
                        label="Complaint subject"
                        value={complaint.subject}
                        onChangeText={(value) =>
                          setComplaint((previous) => ({
                            ...previous,
                            subject: value,
                          }))
                        }
                      />

                      <Field
                        label="Complaint details"
                        multiline
                        value={complaint.message}
                        onChangeText={(value) =>
                          setComplaint((previous) => ({
                            ...previous,
                            message: value,
                          }))
                        }
                      />

                      <Button
                        title="Submit complaint ticket"
                        disabled={busy}
                        onPress={() =>
                          run(async () => {
                            await api(
                              "/order/complaint",
                              "POST",
                              complaint,
                              key,
                            );

                            Alert.alert(
                              "Complaint received",
                              "Our admin team will review your complaint.",
                            );

                            setComplaint({
                              subject: "",
                              message: "",
                            });
                          })
                        }
                      />
                    </Card>
                  )}

                  <Text style={s.h2}>
                    Progress history
                  </Text>

                  {order.history.map((history, i) => (
                    <Card key={i}>
                      <Text style={s.h3}>
                        {statusLabel(history.status)}
                      </Text>
                      <Text style={s.small}>
                        {new Date(
                          history.at,
                        ).toLocaleString()}
                      </Text>
                      <Text style={s.text}>
                        {history.note}
                      </Text>
                    </Card>
                  ))}
                </>
              )}

              {screen === "login" && (
                <>
                  <Text style={s.h1}>
                    Shopper login
                  </Text>

                  <Field
                    label="Email"
                    keyboardType="email-address"
                    autoCapitalize="none"
                    value={email}
                    onChangeText={setEmail}
                  />

                  <Field
                    label="Password"
                    secureTextEntry
                    value={password}
                    onChangeText={setPassword}
                  />

                  <Button
                    title="Sign in"
                    disabled={busy}
                    onPress={() =>
                      run(async () => {
                        const result = await api<{
                          token: string;
                          role: string;
                        }>("/login", "POST", {
                          email,
                          password,
                        });

                        if (result.role !== "shopper") {
                          throw new Error(
                            "This login is for shoppers. Administrators use the separate portal.",
                          );
                        }

                        await saveSession(result.token);
                        setHasSession(true);
                        setPassword("");

                        await dashboard();
                      })
                    }
                  />

                  <Button
                    title={
                      forgot
                        ? "Hide password reset"
                        : "Forgot password?"
                    }
                    secondary
                    onPress={() =>
                      setForgot((previous) => !previous)
                    }
                  />

                  {forgot && (
                    <Card>
                      <Text style={s.h2}>
                        Reset shopper password
                      </Text>

                      <Text style={s.text}>
                        Use the email entered above.
                        A reset code expires in 10 minutes.
                      </Text>

                      <Button
                        title="Email reset code"
                        disabled={busy}
                        onPress={() =>
                          run(async () => {
                            const result = await api<{
                              message: string;
                            }>(
                              "/password/request",
                              "POST",
                              { email },
                            );

                            Alert.alert(
                              "Password reset",
                              result.message,
                            );
                          })
                        }
                      />

                      <Field
                        label="Reset code"
                        value={resetCode}
                        keyboardType="number-pad"
                        maxLength={6}
                        onChangeText={setResetCode}
                      />

                      <Text style={s.small}>
                        Enter your new password of at least
                        12 characters in the Password field
                        above, then confirm below.
                      </Text>

                      <Button
                        title="Confirm new password"
                        disabled={busy}
                        onPress={() =>
                          run(async () => {
                            await api(
                              "/password/confirm",
                              "POST",
                              {
                                email,
                                code: resetCode,
                                password,
                              },
                            );

                            setForgot(false);
                            setResetCode("");
                            setPassword("");

                            Alert.alert(
                              "Password changed",
                              "Sign in with your new password.",
                            );
                          })
                        }
                      />
                    </Card>
                  )}
                </>
              )}

              {screen === "register" && (
                <>
                  <Text style={s.h1}>
                    Become a shopper
                  </Text>

                  <Text style={s.text}>
                    Use your WhatsApp number. Our admin team
                    will contact you by email or WhatsApp
                    after reviewing your application.
                  </Text>

                  {[
                    ["surname", "Surname"],
                    ["firstName", "First name"],
                    ["otherNames", "Other names (optional)"],
                    ["email", "Email"],
                    [
                      "password",
                      "Create password (12+ characters)",
                    ],
                    ["phone", "WhatsApp phone number"],
                    ["address", "Address"],
                    ["residence", "Residence"],
                    [
                      "markets",
                      "Markets you cover, separated by commas",
                    ],
                    ["shoppingFee", "Shopping fee, ₦"],
                  ].map(([field, label]) => (
                    <Field
                      key={field}
                      label={label}
                      value={String(
                        reg[field as keyof typeof reg],
                      )}
                      onChangeText={(value) =>
                        setReg((previous) => ({
                          ...previous,
                          [field]: value,
                        }))
                      }
                      secureTextEntry={
                        field === "password"
                      }
                      autoCapitalize={
                        field === "email" ||
                        field === "password"
                          ? "none"
                          : "sentences"
                      }
                      keyboardType={
                        field === "email"
                          ? "email-address"
                          : field === "phone"
                            ? "phone-pad"
                            : field === "shoppingFee"
                              ? "decimal-pad"
                              : "default"
                      }
                    />
                  ))}

                  <Text style={s.small}>
                    Tip: enter markets around you.
                  </Text>

                  <Button
                    title={
                      "State: " +
                      (reg.state || "Select state")
                    }
                    secondary
                    onPress={() =>
                      setShowStates(
                        (previous) => !previous,
                      )
                    }
                  />

                  {showStates &&
                    states.map((state) => (
                      <Pressable
                        key={state}
                        onPress={() => {
                          setReg((previous) => ({
                            ...previous,
                            state,
                          }));
                          setShowStates(false);
                        }}
                      >
                        <Text style={s.link}>
                          {state}
                        </Text>
                      </Pressable>
                    ))}

                  <Toggle
                    label="Do you own a business? (optional)"
                    value={reg.ownsBusiness}
                    onChange={(value) =>
                      setReg((previous) => ({
                        ...previous,
                        ownsBusiness: value,
                      }))
                    }
                  />

                  {reg.ownsBusiness && (
                    <Field
                      label="What products do you sell?"
                      value={reg.products}
                      onChangeText={(value) =>
                        setReg((previous) => ({
                          ...previous,
                          products: value,
                        }))
                      }
                    />
                  )}

                  <Toggle
                    label="Willing to run errands for customers in local markets?"
                    value={reg.willing}
                    onChange={(value) =>
                      setReg((previous) => ({
                        ...previous,
                        willing: value,
                      }))
                    }
                  />

                  <Toggle
                    label="Willing to provide identification?"
                    value={reg.providesId}
                    onChange={(value) =>
                      setReg((previous) => ({
                        ...previous,
                        providesId: value,
                      }))
                    }
                  />

                  {!reg.providesId ? (
                    <Text style={s.error}>
                      Unfortunately, we cannot accept you
                      without a means of identification.
                    </Text>
                  ) : (
                    <>
                      <Text style={s.small}>
                        Select a clear photo of your entire
                        ID. All text must be readable.
                        JPEG or PNG only, maximum 5 MB.
                      </Text>

                      <Button
                        title={
                          reg.identityFile
                            ? "Identification uploaded ✓"
                            : "Upload identification image (JPEG or PNG, max 5 MB)"
                        }
                        secondary
                        disabled={busy}
                        onPress={() => run(identity)}
                      />
                    </>
                  )}

                  <Toggle
                    label="Are you mobile / do you have transport? (optional)"
                    value={reg.mobile}
                    onChange={(value) =>
                      setReg((previous) => ({
                        ...previous,
                        mobile: value,
                      }))
                    }
                  />

                  <Button
                    title={
                      reg.profilePhoto
                        ? "Profile photo uploaded ✓"
                        : "Upload profile picture"
                    }
                    secondary
                    disabled={busy}
                    onPress={() =>
                      run(() =>
                        photo((id) =>
                          setReg((previous) => ({
                            ...previous,
                            profilePhoto: id,
                          })),
                        ),
                      )
                    }
                  />

                  <Text style={s.small}>
                    Your identity document is restricted to
                    authorized admins. Your photo, markets
                    and shopping fee become public only
                    after approval and availability.
                  </Text>

                  <Button
                    title="Submit application"
                    disabled={
                      busy ||
                      !reg.providesId ||
                      !reg.willing
                    }
                    onPress={() =>
                      run(async () => {
                        if (!reg.profilePhoto) {
                          throw new Error(
                            "Please upload your profile picture.",
                          );
                        }

                        if (!reg.identityFile) {
                          throw new Error(
                            "Please upload an image of your ID.",
                          );
                        }

                        const result = await api<{
                          message: string;
                        }>("/register", "POST", {
                          ...reg,
                          markets: reg.markets
                            .split(",")
                            .map((value) => value.trim())
                            .filter(Boolean),
                          shoppingFee: toKobo(
                            reg.shoppingFee,
                          ),
                        });

                        Alert.alert(
                          "Application received",
                          result.message,
                        );

                        setReg((previous) => ({
                          ...previous,
                          password: "",
                        }));

                        go("login");
                      })
                    }
                  />
                </>
              )}

              {screen === "dashboard" && me && (
                <>
                  <Text style={s.h1}>
                    Hello, {me.firstName}
                  </Text>

                  <Text style={s.badge}>
                    {me.status?.toUpperCase()}
                  </Text>

                  {me.status !== "approved" && (
                    <Card>
                      <Text style={s.text}>
                        {me.reviewReason ||
                          "Our team is reviewing your application. You can receive orders after approval."}
                      </Text>
                    </Card>
                  )}

                  <View style={s.tabs}>
                    {[
                      "Orders",
                      "Availability",
                      "Earnings",
                      "Announcements",
                    ].map((value) => (
                      <Button
                        key={value}
                        title={value}
                        secondary={tab !== value}
                        onPress={() => setTab(value)}
                      />
                    ))}
                  </View>

                  {tab === "Availability" && (
                    <Card>
                      <Toggle
                        label="Available to receive new orders"
                        value={!!me.available}
                        onChange={(value) =>
                          run(async () => {
                            await api(
                              "/me/availability",
                              "PATCH",
                              { available: value },
                            );

                            setMe((previous) =>
                              previous
                                ? {
                                    ...previous,
                                    available: value,
                                  }
                                : previous,
                            );
                          })
                        }
                      />

                      <Text style={s.small}>
                        You appear in Find a shopper only
                        when approved and available.
                      </Text>
                    </Card>
                  )}

                  {tab === "Orders" && (
                    <>
                      <Button
                        title="Refresh orders"
                        secondary
                        disabled={busy}
                        onPress={() =>
                          run(() => dashboard())
                        }
                      />

                      {myOrders.map((shopperOrder) => (
                        <Card key={shopperOrder._id}>
                          <Text style={s.badge}>
                            {statusLabel(
                              shopperOrder.status,
                            )}
                          </Text>

                          <Text style={s.h3}>
                            {shopperOrder.customer.name}
                            {" · "}
                            {shopperOrder.market}
                          </Text>

                          <Text style={s.text}>
                            {shopperOrder.items.length}
                            {" items · "}
                            {shopperOrder.customer.address}
                          </Text>

                          <Button
                            title="Open order"
                            onPress={() => {
                              setOrder(shopperOrder);

                              setPrices(
                                shopperOrder.items.map(
                                  (item, i) =>
                                    String(
                                      (
                                        shopperOrder.quote
                                          ?.unitPrices[i] ??
                                        item.estimatedUnitPrice ??
                                        0
                                      ) / 100,
                                    ),
                                ),
                              );

                              setTransport(
                                String(
                                  (
                                    shopperOrder.quote
                                      ?.transportFee || 0
                                  ) / 100,
                                ),
                              );

                              setFee(
                                String(
                                  (
                                    shopperOrder.quote
                                      ?.shoppingFee ??
                                    me.shoppingFee
                                  ) / 100,
                                ),
                              );

                              setNotes(
                                shopperOrder.quote?.note ||
                                  "",
                              );

                              go("shopperOrder");
                            }}
                          />
                        </Card>
                      ))}

                      <View style={s.row}>
                        <Button
                          title="Previous"
                          secondary
                          disabled={
                            myPage === 1 || busy
                          }
                          onPress={() =>
                            run(() =>
                              dashboard(myPage - 1),
                            )
                          }
                        />

                        <Text>{myPage}</Text>

                        <Button
                          title="Next"
                          secondary
                          disabled={
                            myPage * 20 >= myTotal ||
                            busy
                          }
                          onPress={() =>
                            run(() =>
                              dashboard(myPage + 1),
                            )
                          }
                        />
                      </View>
                    </>
                  )}

                  {tab === "Earnings" && (
                    <>
                      <Card>
                        <Text style={s.h2}>
                          Across all paid orders
                        </Text>

                        <Text style={s.text}>
                          Orders: {earnings.orders}
                          {"\n"}
                          Shopping earnings after platform
                          fees:{" "}
                          {naira(
                            earnings.shoppingEarnings,
                          )}
                          {"\n"}
                          Settlement cleared:{" "}
                          {naira(earnings.cleared)}
                          {"\n"}
                          Settlement pending:{" "}
                          {naira(earnings.pending)}
                        </Text>
                      </Card>

                      <Text style={s.text}>
                        Platform fee for new quotes:{" "}
                        {naira(platformFee)}. This is
                        deducted from your settlement.
                        Existing quotes keep their original
                        fee.
                      </Text>

                      <Text style={s.small}>
                        Settlement includes item costs and
                        transport; it is not all profit.
                        Records below reflect this page of
                        orders.
                      </Text>

                      {myOrders
                        .filter(
                          (shopperOrder) =>
                            shopperOrder.quote,
                        )
                        .map((shopperOrder) => (
                          <Card key={shopperOrder._id}>
                            <Text style={s.h3}>
                              {shopperOrder.customer.name}
                            </Text>

                            <Text style={s.text}>
                              Customer total:{" "}
                              {naira(
                                shopperOrder.quote!.total,
                              )}
                              {"\n"}
                              Platform fee:{" "}
                              {naira(
                                shopperOrder.quote!
                                  .platformFee || 0,
                              )}
                              {"\n"}
                              Your settlement:{" "}
                              {naira(
                                shopperOrder.quote!
                                  .shopperSettlement || 0,
                              )}
                            </Text>

                            <Text style={s.badge}>
                              {shopperOrder.payout
                                ? "Settlement cleared"
                                : "Not yet cleared"}
                            </Text>
                          </Card>
                        ))}
                    </>
                  )}

                  {tab === "Announcements" &&
                    announcements.map((announcement) => (
                      <Card key={announcement._id}>
                        <Text style={s.h3}>
                          {announcement.title}
                        </Text>
                        <Text style={s.text}>
                          {announcement.body}
                        </Text>
                      </Card>
                    ))}

                  <Button
                    title="Profile & bank settings"
                    secondary
                    disabled={busy}
                    onPress={() => run(settings)}
                  />

                  <Button
                    title="Logout"
                    secondary
                    disabled={busy}
                    onPress={() =>
                      run(async () => {
                        try {
                          await api(
                            "/logout",
                            "POST",
                            {},
                          );
                        } finally {
                          await clearSession();
                          setHasSession(false);
                          setMe(null);
                          go("home");
                        }
                      })
                    }
                  />
                </>
              )}

              {screen === "shopperOrder" && order && (
                <>
                  <Text style={s.h1}>
                    Order details
                  </Text>

                  <OrderDetails order={order} />

                  <Button
                    title="Contact customer on WhatsApp"
                    secondary
                    onPress={() =>
                      run(async () => {
                        await Linking.openURL(
                          "https://wa.me/" +
                            order.customer.phone.replace(
                              /\D/g,
                              "",
                            ),
                        );
                      })
                    }
                  />

                  {[
                    "new",
                    "quoted",
                    "quote_rejected",
                  ].includes(order.status) && (
                    <Card>
                      <Text style={s.h2}>
                        Cost this order
                      </Text>

                      {order.rejectionReason && (
                        <Text style={s.error}>
                          Rejected:{" "}
                          {order.rejectionReason}
                        </Text>
                      )}

                      {order.items.map((item, i) => (
                        <Field
                          key={i}
                          label={`${item.name}: price per ${item.unit}, ₦`}
                          keyboardType="decimal-pad"
                          value={prices[i] || ""}
                          onChangeText={(value) =>
                            setPrices((previous) =>
                              previous.map(
                                (price, index) =>
                                  index === i
                                    ? value
                                    : price,
                              ),
                            )
                          }
                        />
                      ))}

                      <Field
                        label="Transport fee, ₦"
                        keyboardType="decimal-pad"
                        value={transport}
                        onChangeText={setTransport}
                      />

                      <Field
                        label="Shopping fee, ₦"
                        keyboardType="decimal-pad"
                        value={fee}
                        onChangeText={setFee}
                      />

                      <Text style={s.text}>
                        Current platform deduction:{" "}
                        {naira(platformFee)}
                      </Text>

                      <Field
                        label="Quote note"
                        multiline
                        value={notes}
                        onChangeText={setNotes}
                      />

                      <Button
                        title="Send quote"
                        disabled={busy}
                        onPress={() =>
                          run(async () => {
                            await api(
                              `/me/orders/${order._id}/quote`,
                              "POST",
                              {
                                unitPrices:
                                  prices.map(toKobo),
                                transportFee:
                                  toKobo(transport),
                                shoppingFee:
                                  toKobo(fee),
                                note: notes,
                              },
                            );

                            await dashboard();
                          })
                        }
                      />

                      <Field
                        label="Cancellation reason"
                        value={reason}
                        onChangeText={setReason}
                      />

                      <Button
                        title="Cancel unaccepted order"
                        secondary
                        disabled={busy || !reason}
                        onPress={() =>
                          run(async () => {
                            await api(
                              `/me/orders/${order._id}/cancel`,
                              "POST",
                              { reason },
                            );

                            await dashboard();
                          })
                        }
                      />
                    </Card>
                  )}

                  {order.status === "paid" && (
                    <Button
                      title="Mark shopping in progress"
                      disabled={busy}
                      onPress={() =>
                        run(async () => {
                          await api(
                            `/me/orders/${order._id}/status`,
                            "POST",
                            { status: "shopping" },
                          );

                          await dashboard();
                        })
                      }
                    />
                  )}

                  {order.status === "shopping" && (
                    <Button
                      title="Mark delivered"
                      disabled={busy}
                      onPress={() =>
                        run(async () => {
                          await api(
                            `/me/orders/${order._id}/status`,
                            "POST",
                            { status: "delivered" },
                          );

                          await dashboard();
                        })
                      }
                    />
                  )}

                  <Text style={s.small}>
                    Only mark delivered after the customer
                    receives the order. The 24-hour complaint
                    window starts at that time.
                  </Text>
                </>
              )}

              {screen === "settings" && me && (
                <>
                  <Text style={s.h1}>
                    Shopper settings
                  </Text>

                  <Text style={s.text}>
                    Changes require a code sent to{" "}
                    {me.email}. Codes expire in 10 minutes.
                  </Text>

                  {me.bank && (
                    <Card>
                      <Text style={s.text}>
                        {me.bank.name}
                        {"\n"}
                        {me.bank.accountName}
                        {"\n"}
                        {me.bank.accountNumber}
                      </Text>
                    </Card>
                  )}

                  <Field
                    label="Shopping fee, ₦"
                    keyboardType="decimal-pad"
                    value={settingsFee}
                    onChangeText={setSettingsFee}
                  />

                  <Button
                    title={
                      newPhoto
                        ? "New picture uploaded ✓"
                        : "Choose new profile picture"
                    }
                    secondary
                    disabled={busy}
                    onPress={() =>
                      run(() => photo(setNewPhoto))
                    }
                  />

                  <Field
                    label="Search bank name (optional bank change)"
                    value={bankSearch}
                    onChangeText={setBankSearch}
                  />

                  {bankSearch !== "" &&
                    banks
                      .filter((bank) =>
                        bank.name
                          .toLowerCase()
                          .includes(
                            bankSearch.toLowerCase(),
                          ),
                      )
                      .slice(0, 12)
                      .map((bank) => (
                        <Button
                          key={bank.code}
                          title={
                            (bank.code === bankCode
                              ? "✓ "
                              : "") + bank.name
                          }
                          secondary
                          onPress={() => {
                            setBankCode(bank.code);
                            setBankSearch(bank.name);
                            setAccountName("");
                          }}
                        />
                      ))}

                  <Field
                    label="10-digit account number"
                    keyboardType="number-pad"
                    maxLength={10}
                    value={accountNumber}
                    onChangeText={(value) => {
                      setAccountNumber(value);
                      setAccountName("");
                    }}
                  />

                  <Button
                    title="Verify account name"
                    secondary
                    disabled={
                      busy ||
                      !bankCode ||
                      accountNumber.length !== 10
                    }
                    onPress={() =>
                      run(async () => {
                        const result = await api<{
                          accountName: string;
                        }>("/banks/resolve", "POST", {
                          bankCode,
                          accountNumber,
                        });

                        setAccountName(
                          result.accountName,
                        );
                      })
                    }
                  />

                  {accountName !== "" && (
                    <Text style={s.badge}>
                      {accountName}
                    </Text>
                  )}

                  <Button
                    title="Email a confirmation code"
                    disabled={
                      busy ||
                      (!!bankCode && !accountName)
                    }
                    onPress={() =>
                      run(async () => {
                        await api(
                          "/me/settings/request",
                          "POST",
                          {
                            shoppingFee:
                              toKobo(settingsFee),
                            ...(newPhoto
                              ? {
                                  profilePhoto: newPhoto,
                                }
                              : {}),
                            ...(bankCode
                              ? {
                                  bankCode,
                                  accountNumber,
                                }
                              : {}),
                          },
                        );

                        setOtpSent(true);

                        Alert.alert(
                          "Check your email",
                          "Enter the code to apply these exact changes.",
                        );
                      })
                    }
                  />

                  {otpSent && (
                    <>
                      <Field
                        label="6-digit email code"
                        keyboardType="number-pad"
                        maxLength={6}
                        value={otp}
                        onChangeText={setOtp}
                      />

                      <Button
                        title="Confirm changes"
                        disabled={busy}
                        onPress={() =>
                          run(async () => {
                            await api(
                              "/me/settings/confirm",
                              "POST",
                              { code: otp },
                            );

                            await dashboard();
                          })
                        }
                      />
                    </>
                  )}
                </>
              )}

              {screen === "terms" && (
                <>
                  <Text style={s.h1}>
                    Terms & privacy
                  </Text>

                  <Card>
                    <Text style={s.h3}>
                      Shopping and payment
                    </Text>
                    <Text style={s.text}>
                      A shopper quotes item costs, transport
                      and their shopping fee. Review and
                      accept the total before paying through
                      Paystack. Payments are collected by the
                      platform. Do not send money directly to
                      a shopper for an app order.
                    </Text>

                    <Text style={s.h3}>
                      Delivery and complaints
                    </Text>
                    <Text style={s.text}>
                      The shopper updates order progress.
                      You may confirm receipt. Complaints
                      about products or service must be
                      submitted from your order page within
                      24 hours after the order is marked
                      delivered. The app shows the exact
                      deadline. The admin team reviews
                      tickets; refunds require a review and
                      are not automatic.
                    </Text>

                    <Text style={s.h3}>
                      Privacy
                    </Text>
                    <Text style={s.text}>
                      Your selected shopper receives your
                      shopping list, name, email, WhatsApp
                      number and address to fulfil the
                      order. Your private order ID unlocks
                      your order; keep it secret. Shopper
                      identity documents are encrypted and
                      restricted to authorized admins.
                      Shoppers are listed only when approved
                      and available.
                    </Text>

                    <Text style={s.h3}>
                      Shopper settlement
                    </Text>
                    <Text style={s.text}>
                      A platform fee is deducted from shopper
                      settlement. Final settlement can be
                      recorded after the 24-hour delivery
                      complaint window and resolution of open
                      complaints. Bank changes require email
                      confirmation. Administrators record
                      completed transfers with a reference;
                      the app does not transfer funds
                      automatically.
                    </Text>
                  </Card>
                </>
              )}
            </ScrollView>
          </KeyboardAvoidingView>
        </SafeAreaView>
      }
    >
      {children}
    </ScreenContext.Provider>
  );
}

function OrderDetails({ order }: { order: Order }) {
  return (
    <Card>
      <Text style={s.h3}>
        {order.market}
      </Text>

      <Text style={s.text}>
        {order.customer.name}
        {"\n"}
        {order.customer.address}
        {"\n"}
        WhatsApp: {order.customer.phone}
        {"\n"}
        Email: {order.customer.email}
      </Text>

      {order.items.map((item, i) => (
        <View
          key={i}
          style={{ paddingVertical: 8 }}
        >
          <Text style={s.h3}>
            {item.name} · {item.quantity} {item.unit}
          </Text>

          <Text style={s.small}>
            Estimated unit price:{" "}
            {item.estimatedUnitPrice === null
              ? "Shopper to cost"
              : naira(item.estimatedUnitPrice)}
            {order.quote &&
              ` · Quoted: ${naira(
                order.quote.unitPrices[i],
              )}`}
          </Text>
        </View>
      ))}

      {order.notes && (
        <Text style={s.text}>
          Notes: {order.notes}
        </Text>
      )}

      {order.quote && (
        <>
          <View style={s.line} />

          <Text style={s.text}>
            Items: {naira(order.quote.itemsTotal)}
            {"\n"}
            Transport: {naira(order.quote.transportFee)}
            {"\n"}
            Shopping fee: {naira(order.quote.shoppingFee)}
          </Text>

          <Text style={s.price}>
            Total: {naira(order.quote.total)}
          </Text>

          <Text style={s.text}>
            {order.quote.note}
          </Text>

          {order.quote.platformFee !== undefined && (
            <Text style={s.small}>
              Platform deduction:{" "}
              {naira(order.quote.platformFee)}
              {" · "}
              Your settlement:{" "}
              {naira(
                order.quote.shopperSettlement || 0,
              )}
            </Text>
          )}
        </>
      )}

      {order.cancelReason && (
        <Text style={s.error}>
          Cancelled: {order.cancelReason}
        </Text>
      )}

      {order.payout && (
        <Text style={s.badge}>
          Shopper settlement cleared
        </Text>
      )}
    </Card>
  );
}

export function RouteScreen() {
  return <>{React.useContext(ScreenContext)}</>;
}