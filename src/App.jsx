import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  HOSTS,
  buildGoldUrl,
  buildHistoryUrl,
  buildPricesUrl,
  fetchJson
} from "./api.js";

const todayIso = () => new Date().toISOString().slice(0, 10);

const addDays = (isoDate, days) => {
  const date = new Date(isoDate);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
};

const formatNumber = (value) => {
  if (value === null || value === undefined || Number.isNaN(value)) {
    return "—";
  }
  return Number(value).toLocaleString();
};

const formatTimestamp = (value) => {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
};

const formatTimeScale = (value) => {
  if (!value) return "—";
  const numeric = Number(value);
  return Number.isNaN(numeric) ? String(value) : `${numeric}h`;
};

const summarizePrices = (entries) => {
  if (!entries?.length) return null;
  const sell = entries.map((item) => item.sell_price_min).filter(Boolean);
  const buy = entries.map((item) => item.buy_price_max).filter(Boolean);
  const average = (list) =>
    list.length
      ? Math.round(list.reduce((sum, val) => sum + val, 0) / list.length)
      : null;
  return {
    sellAverage: average(sell),
    buyAverage: average(buy),
    sellMin: sell.length ? Math.min(...sell) : null,
    sellMax: sell.length ? Math.max(...sell) : null
  };
};

const summarizeHistoryEntry = (entry) => {
  if (!entry || !Array.isArray(entry.data) || entry.data.length === 0) {
    return {
      avg_price: entry?.avg_price ?? null,
      min_price: entry?.min_price ?? null,
      max_price: entry?.max_price ?? null,
      data_points: entry?.data_points ?? null,
      timeScale: entry?.timescale ?? entry?.time_scale ?? entry?.timeScale ?? null
    };
  }

  const avgPrices = entry.data.map((item) => item?.avg_price).filter(Number.isFinite);
  const minPrices = entry.data.map((item) => item?.min_price).filter(Number.isFinite);
  const maxPrices = entry.data.map((item) => item?.max_price).filter(Number.isFinite);
  const average = (list) =>
    list.length ? list.reduce((sum, val) => sum + val, 0) / list.length : null;
  const avg = average(avgPrices);

  return {
    avg_price: avg === null ? null : Math.round(avg),
    min_price: minPrices.length ? Math.min(...minPrices) : null,
    max_price: maxPrices.length ? Math.max(...maxPrices) : null,
    data_points: entry?.data_points ?? entry.data.length,
    timeScale: entry?.timescale ?? entry?.time_scale ?? entry?.timeScale ?? null
  };
};

const ITEM_CATALOG_URL =
  "https://raw.githubusercontent.com/ao-data/ao-bin-dumps/master/formatted/items.json";
const RECENT_PRESETS_KEY = "albionRecentPresets";
const MAX_RECENT_PRESETS = 4;
const PRESET_PANEL_STATE_KEY = "albionPresetPanels";

const normalizeSearchText = (value) =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

const pickLocalizedName = (entry) => {
  if (!entry) return "";
  const names =
    entry.LocalizedNames ||
    entry.localizedNames ||
    entry.LocalizedName ||
    entry.localizedName ||
    entry.LocalizationName ||
    entry.localizationName;
  if (typeof names === "string") return names;
  if (names && typeof names === "object") {
    return (
      names["EN-US"] ||
      names["en-US"] ||
      names.EN ||
      names.en ||
      names["en"] ||
      ""
    );
  }
  return (
    entry.Name ||
    entry.name ||
    entry.DisplayName ||
    entry.displayName ||
    entry.label ||
    ""
  );
};

const buildItemCatalog = (payload) => {
  if (!Array.isArray(payload)) return [];
  return payload
    .map((entry) => {
      const id =
        entry.UniqueName ||
        entry.uniqueName ||
        entry.item_id ||
        entry.itemId ||
        entry.ItemID ||
        entry.ItemId ||
        entry.Id ||
        entry.id;
      if (!id) return null;
      const name = pickLocalizedName(entry) || id;
      const idLower = String(id).toLowerCase();
      const nameLower = String(name).toLowerCase();
      return {
        id,
        name,
        idLower,
        nameLower,
        searchKey: normalizeSearchText(`${id} ${name}`)
      };
    })
    .filter(Boolean);
};

const rankItem = (item, primaryToken) => {
  if (!primaryToken) return 2;
  if (item.idLower.startsWith(primaryToken) || item.nameLower.startsWith(primaryToken)) {
    return 0;
  }
  if (item.searchKey.includes(` ${primaryToken}`)) return 1;
  return 2;
};

const normalizeItemCsv = (value) =>
  typeof value === "string"
    ? value
        .split(",")
        .map((entry) => entry.trim())
        .filter(Boolean)
        .join(",")
    : "";

const presets = [
  {
    label: "Tier 4 resources",
    items: "T4_ORE,T4_HIDE,T4_FIBER,T4_WOOD,T4_ROCK"
  },
  {
    label: "Tier 5 resources",
    items: "T5_ORE,T5_HIDE,T5_FIBER,T5_WOOD,T5_ROCK"
  },
  {
    label: "Tier 6 resources",
    items: "T6_ORE,T6_HIDE,T6_FIBER,T6_WOOD,T6_ROCK"
  },
  {
    label: "Popular crafts",
    items: "T4_BAG,T4_CAPE,T4_2H_AXE,T4_MAIN_SPEAR,T4_2H_FIRESTAFF"
  }
];

const CITY_OPTIONS = [
  "Bridgewatch",
  "Fort Sterling",
  "Lymhurst",
  "Martlock",
  "Thetford",
  "Caerleon",
  "Brecilien",
  "Black Market"
];

const regions = Object.keys(HOSTS);

export default function App() {
  const [tab, setTab] = useState("prices");
  const [region, setRegion] = useState(
    regions.includes("Europe") ? "Europe" : regions[0]
  );
  const [items, setItems] = useState("T4_BAG");
  const [itemSearch, setItemSearch] = useState("");
  const [itemCatalog, setItemCatalog] = useState([]);
  const [itemCatalogStatus, setItemCatalogStatus] = useState("idle");
  const [itemCatalogError, setItemCatalogError] = useState("");
  const [itemDropdownOpen, setItemDropdownOpen] = useState(false);
  const [recentPresets, setRecentPresets] = useState([]);
  const [presetPanels, setPresetPanels] = useState({
    quick: true,
    recent: true
  });
  const [locations, setLocations] = useState(
    "Bridgewatch,Martlock,Thetford"
  );
  const [qualities, setQualities] = useState("1,2,3");
  const [historyDate, setHistoryDate] = useState(addDays(todayIso(), -7));
  const [historyEnd, setHistoryEnd] = useState(todayIso());
  const [timeScale, setTimeScale] = useState("24");
  const [goldCount, setGoldCount] = useState("30");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [prices, setPrices] = useState([]);
  const [history, setHistory] = useState([]);
  const [gold, setGold] = useState([]);
  const itemFieldRef = useRef(null);

  const summary = useMemo(() => summarizePrices(prices), [prices]);
  const matchingItems = useMemo(() => {
    const normalizedSearch = normalizeSearchText(itemSearch);
    if (!normalizedSearch || itemCatalog.length === 0) return [];
    const tokens = normalizedSearch.split(" ").filter(Boolean);
    const results = itemCatalog.filter((entry) =>
      tokens.every((token) => entry.searchKey.includes(token))
    );
    const primaryToken = tokens[0];
    results.sort((a, b) => rankItem(a, primaryToken) - rankItem(b, primaryToken));
    return results;
  }, [itemSearch, itemCatalog]);

  const locationSuggestions = useMemo(() => {
    const parts = locations.split(",");
    const last = parts[parts.length - 1]?.trim() ?? "";
    if (!last) return [];
    const used = new Set(
      parts
        .slice(0, -1)
        .map((entry) => entry.trim().toLowerCase())
        .filter(Boolean)
    );
    const token = last.toLowerCase();
    return CITY_OPTIONS.filter((city) => {
      const lower = city.toLowerCase();
      return lower.includes(token) && !used.has(lower);
    }).slice(0, 6);
  }, [locations]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const stored = window.localStorage.getItem(RECENT_PRESETS_KEY);
    if (!stored) return;
    try {
      const parsed = JSON.parse(stored);
      if (Array.isArray(parsed)) {
        const trimmed = parsed
          .map((entry) => ({
            items: normalizeItemCsv(entry.items ?? entry)
          }))
          .filter((entry) => entry.items)
          .slice(0, MAX_RECENT_PRESETS);
        setRecentPresets(trimmed);
      }
    } catch (err) {
      setRecentPresets([]);
    }
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(RECENT_PRESETS_KEY, JSON.stringify(recentPresets));
  }, [recentPresets]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const stored = window.localStorage.getItem(PRESET_PANEL_STATE_KEY);
    if (!stored) return;
    try {
      const parsed = JSON.parse(stored);
      if (parsed && typeof parsed === "object") {
        setPresetPanels((prev) => ({
          quick: typeof parsed.quick === "boolean" ? parsed.quick : prev.quick,
          recent: typeof parsed.recent === "boolean" ? parsed.recent : prev.recent
        }));
      }
    } catch (err) {
      setPresetPanels((prev) => prev);
    }
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(PRESET_PANEL_STATE_KEY, JSON.stringify(presetPanels));
  }, [presetPanels]);

  useEffect(() => {
    if (!itemDropdownOpen) return;
    const handleOutsideClick = (event) => {
      const target = event.target;
      if (!itemFieldRef.current || !target) return;
      if (!itemFieldRef.current.contains(target)) {
        setItemDropdownOpen(false);
      }
    };
    window.addEventListener("mousedown", handleOutsideClick);
    window.addEventListener("touchstart", handleOutsideClick);
    return () => {
      window.removeEventListener("mousedown", handleOutsideClick);
      window.removeEventListener("touchstart", handleOutsideClick);
    };
  }, [itemDropdownOpen]);

  const loadItemCatalog = async () => {
    if (itemCatalogStatus === "loading" || itemCatalog.length > 0) {
      return;
    }
    setItemCatalogStatus("loading");
    setItemCatalogError("");
    try {
      const response = await fetch(ITEM_CATALOG_URL);
      if (!response.ok) {
        throw new Error(`Catalog request failed (${response.status})`);
      }
      const payload = await response.json();
      const catalog = buildItemCatalog(payload);
      setItemCatalog(catalog);
      setItemCatalogStatus("ready");
    } catch (err) {
      setItemCatalogStatus("error");
      setItemCatalogError(err.message ?? "Unable to load item catalog.");
    }
  };

  const addItemIds = (ids) => {
    if (!ids?.length) return;
    const current = items
      .split(",")
      .map((entry) => entry.trim())
      .filter(Boolean);
    const next = [...current];
    ids.forEach((id) => {
      if (!next.includes(id)) next.push(id);
    });
    setItems(next.join(","));
  };

  const addRecentPreset = (value) => {
    const normalized = normalizeItemCsv(value);
    if (!normalized) return;
    setRecentPresets((prev) => {
      const next = [
        { items: normalized },
        ...prev.filter((entry) => entry.items !== normalized)
      ];
      return next.slice(0, MAX_RECENT_PRESETS);
    });
  };

  const handleSearchChange = (event) => {
    const value = event.target.value;
    setItemSearch(value);
    if (value.trim()) {
      setItemDropdownOpen(true);
    } else {
      setItemDropdownOpen(false);
    }
    if (value.trim().length >= 2) {
      loadItemCatalog();
    }
  };

  const handleSearchKeyDown = (event) => {
    if (event.key !== "Enter") return;
    event.preventDefault();
    if (matchingItems.length === 0) return;
    addItemIds([matchingItems[0].id]);
    setItemSearch("");
    setItemDropdownOpen(false);
  };

  const handleSearchFocus = () => {
    setItemDropdownOpen(true);
    loadItemCatalog();
  };

  const handleAddMatches = () => {
    if (matchingItems.length === 0) return;
    addItemIds(matchingItems.map((entry) => entry.id));
    setItemSearch("");
    setItemDropdownOpen(false);
  };

  const applyLocationSuggestion = (city) => {
    const parts = locations
      .split(",")
      .slice(0, -1)
      .map((entry) => entry.trim())
      .filter(Boolean);
    const next = [...parts, city].join(", ");
    setLocations(`${next}, `);
  };

  const fetchPrices = async () => {
    setError("");
    setTab("prices");
    setLoading(true);
    try {
      const url = buildPricesUrl({ region, items, locations, qualities });
      addRecentPreset(items);
      const data = await fetchJson(url);
      setPrices(Array.isArray(data) ? data : []);
    } catch (err) {
      setError(err.message ?? "Failed to load prices.");
    } finally {
      setLoading(false);
    }
  };

  const fetchHistory = async () => {
    setError("");
    setTab("history");
    setLoading(true);
    try {
      const url = buildHistoryUrl({
        region,
        items,
        locations,
        qualities,
        date: historyDate,
        endDate: historyEnd,
        timeScale
      });
      addRecentPreset(items);
      const data = await fetchJson(url);
      setHistory(Array.isArray(data) ? data : []);
    } catch (err) {
      setError(err.message ?? "Failed to load history.");
    } finally {
      setLoading(false);
    }
  };

  const fetchGold = async () => {
    setError("");
    setTab("gold");
    setLoading(true);
    try {
      const url = buildGoldUrl({ region, count: goldCount });
      const data = await fetchJson(url);
      setGold(Array.isArray(data) ? data : []);
    } catch (err) {
      setError(err.message ?? "Failed to load gold prices.");
    } finally {
      setLoading(false);
    }
  };

  const quickLoad = (presetItems) => {
    setItems(presetItems);
    setTab("prices");
  };

  const togglePresetPanel = (key) => {
    setPresetPanels((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  return (
    <div className="app">
      <header className="hero">
        <div>
          <p className="eyebrow">Albion Market Intelligence</p>
          <h1>Albion Dashboard</h1>
          <p className="lede">
            Query live market snapshots, track historical swings, and monitor
            gold prices across Albion Online regions.
          </p>
        </div>
        <div className="hero-card">
          <div className="hero-card-top">
            <span>Region</span>
            <select value={region} onChange={(event) => setRegion(event.target.value)}>
              {regions.map((item) => (
                <option key={item} value={item}>
                  {item}
                </option>
              ))}
            </select>
          </div>
          <p className="hero-card-note">
            All requests go through the Albion Online Data Project APIs. Choose
            a region to match in-game servers.
          </p>
        </div>
      </header>

      <div className="main-grid">
        <div className="main-content">
          <section className="panel">
            <div className="panel-header">
              <div>
                <h2>Query builder</h2>
                <p>Provide item IDs, locations, and qualities for the API calls.</p>
              </div>
              <div className="tab-row">
                <button
                  className={tab === "prices" ? "tab active" : "tab"}
                  onClick={() => setTab("prices")}
                  type="button"
                >
                  Prices
                </button>
                <button
                  className={tab === "history" ? "tab active" : "tab"}
                  onClick={() => setTab("history")}
                  type="button"
                >
                  History
                </button>
                <button
                  className={tab === "gold" ? "tab active" : "tab"}
                  onClick={() => setTab("gold")}
                  type="button"
                >
                  Gold
                </button>
              </div>
            </div>

            <div className="form-grid">
              <div className="item-field" ref={itemFieldRef}>
                <label>
                  Search by name
                  <input
                    value={itemSearch}
                    onChange={handleSearchChange}
                    onFocus={handleSearchFocus}
                    onKeyDown={handleSearchKeyDown}
                    placeholder="e.g. Adept's Bag, T6 ore, Elder's"
                  />
                </label>
                <label>
                  Item IDs
                  <input
                    value={items}
                    onChange={(event) => setItems(event.target.value)}
                    placeholder="T4_BAG,T4_2H_AXE"
                  />
                </label>
                <div className="item-search-meta">
                  <span>
                    {itemCatalogStatus === "loading" && "Loading item catalog..."}
                    {itemCatalogStatus === "error" && itemCatalogError}
                    {itemCatalogStatus === "ready" && itemSearch.trim()
                      ? `${matchingItems.length} match${matchingItems.length === 1 ? "" : "es"}`
                      : "Type 2+ characters to search."}
                  </span>
                  <div className="item-search-actions">
                    <button
                      type="button"
                      onClick={handleAddMatches}
                      disabled={matchingItems.length === 0}
                    >
                      Add matches
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setItemSearch("");
                        setItemDropdownOpen(false);
                      }}
                    >
                      Clear
                    </button>
                  </div>
                </div>
                {itemDropdownOpen && (
                  <div className="item-search-results">
                    {itemSearch.trim() &&
                      itemCatalogStatus === "ready" &&
                      matchingItems.length === 0 && (
                        <div className="item-search-empty">No matching items.</div>
                      )}
                    {matchingItems.slice(0, 12).map((entry) => (
                      <div key={entry.id} className="item-search-result">
                        <div>
                          <strong>{entry.id}</strong>
                          <small>{entry.name}</small>
                        </div>
                        <button
                          type="button"
                          onClick={() => {
                            addItemIds([entry.id]);
                            setItemDropdownOpen(false);
                          }}
                        >
                          Add
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
              <label className="location-field">
                Cities / Locations
                <input
                  value={locations}
                  onChange={(event) => setLocations(event.target.value)}
                  placeholder="Bridgewatch,Martlock"
                />
                {locationSuggestions.length > 0 && (
                  <div className="location-suggestions">
                    {locationSuggestions.map((city) => (
                      <button
                        key={city}
                        type="button"
                        onClick={() => applyLocationSuggestion(city)}
                      >
                        {city}
                      </button>
                    ))}
                  </div>
                )}
              </label>
              <label>
                Quality (1-5)
                <input
                  value={qualities}
                  onChange={(event) => setQualities(event.target.value)}
                  placeholder="1,2,3"
                />
              </label>
              {tab === "history" && (
                <div className="history-fields">
                  <label>
                    Start date
                    <input
                      type="date"
                      value={historyDate}
                      onChange={(event) => setHistoryDate(event.target.value)}
                    />
                  </label>
                  <label>
                    End date
                    <input
                      type="date"
                      value={historyEnd}
                      onChange={(event) => setHistoryEnd(event.target.value)}
                    />
                  </label>
                  <label>
                    Time scale
                    <select
                      value={timeScale}
                      onChange={(event) => setTimeScale(event.target.value)}
                    >
                      <option value="1">Hour</option>
                      <option value="24">Day</option>
                    </select>
                  </label>
                </div>
              )}
              {tab === "gold" && (
                <label>
                  Gold samples
                  <input
                    type="number"
                    min="1"
                    value={goldCount}
                    onChange={(event) => setGoldCount(event.target.value)}
                  />
                </label>
              )}
            </div>

            <div className="actions">
              <button
                type="button"
                onClick={fetchPrices}
                disabled={loading}
                className="primary"
              >
                Fetch prices
              </button>
              <button type="button" onClick={fetchHistory} disabled={loading}>
                Fetch history
              </button>
              <button type="button" onClick={fetchGold} disabled={loading}>
                Fetch gold
              </button>
              {loading && <span className="status">Loading…</span>}
              {error && <span className="status error">{error}</span>}
            </div>
          </section>

          <section className="panel">
            <div className="panel-header">
              <h2>Results</h2>
              <p>Latest response from the selected API endpoint.</p>
            </div>

            {tab === "prices" && (
              <div className="results">
                <div className="summary">
                  <div>
                    <span>Average sell</span>
                    <strong>{formatNumber(summary?.sellAverage)}</strong>
                  </div>
                  <div>
                    <span>Average buy</span>
                    <strong>{formatNumber(summary?.buyAverage)}</strong>
                  </div>
                  <div>
                    <span>Sell min / max</span>
                    <strong>
                      {formatNumber(summary?.sellMin)} /{" "}
                      {formatNumber(summary?.sellMax)}
                    </strong>
                  </div>
                </div>

                <div className="table">
                  <div className="table-row header">
                    <span>Item</span>
                    <span>Location</span>
                    <span>Sell</span>
                    <span>Buy</span>
                    <span>Updated</span>
                    <span>Quality</span>
                  </div>
                  {prices.length === 0 && (
                    <div className="table-row empty">No price data yet.</div>
                  )}
                  {prices.map((entry, index) => (
                    <div
                      key={`${entry.item_id}-${entry.city}-${index}`}
                      className="table-row"
                    >
                      <span>{entry.item_id}</span>
                      <span>{entry.city}</span>
                      <span>{formatNumber(entry.sell_price_min)}</span>
                      <span>{formatNumber(entry.buy_price_max)}</span>
                      <span>{formatTimestamp(entry.sell_price_min_date)}</span>
                      <span>{entry.quality ?? "—"}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {tab === "history" && (
              <div className="results">
                <div className="table">
                  <div className="table-row header">
                    <span>Item</span>
                    <span>Location</span>
                    <span>Avg price</span>
                    <span>Min / Max</span>
                    <span>Data points</span>
                    <span>Time scale</span>
                  </div>
                  {history.length === 0 && (
                    <div className="table-row empty">No history data yet.</div>
                  )}
                  {history.map((entry, index) => {
                    const summary = summarizeHistoryEntry(entry);
                    const locationLabel = entry.location ?? entry.city ?? "—";
                    return (
                      <div
                        key={`${entry.item_id}-${entry.location}-${index}`}
                        className="table-row"
                      >
                        <span>{entry.item_id}</span>
                        <span>{locationLabel}</span>
                        <span>{formatNumber(summary.avg_price)}</span>
                        <span>
                          {formatNumber(summary.min_price)} /{" "}
                          {formatNumber(summary.max_price)}
                        </span>
                        <span>{formatNumber(summary.data_points)}</span>
                        <span>{formatTimeScale(summary.timeScale ?? timeScale)}</span>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {tab === "gold" && (
              <div className="results">
                <div className="table">
                  <div className="table-row header two-col">
                    <span>Timestamp</span>
                    <span>Price</span>
                  </div>
                  {gold.length === 0 && (
                    <div className="table-row empty">No gold data yet.</div>
                  )}
                  {gold.map((entry, index) => (
                    <div key={`${entry.timestamp}-${index}`} className="table-row two-col">
                      <span>{formatTimestamp(entry.timestamp)}</span>
                      <span>{formatNumber(entry.price)}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </section>
        </div>

        <aside className="side-column">
          <section className="panel">
            <div className="panel-header">
              <h2>Quick resource presets</h2>
              <p>Populate the item list with common resource bundles.</p>
              <button
                type="button"
                className="collapse-toggle"
                onClick={() => togglePresetPanel("quick")}
              >
                {presetPanels.quick ? "Collapse" : "Expand"}
              </button>
            </div>
            {presetPanels.quick && (
              <div className="preset-grid">
                {presets.map((preset) => (
                  <button
                    key={preset.label}
                    type="button"
                    className="preset"
                    onClick={() => quickLoad(preset.items)}
                    title={preset.items}
                  >
                    <span>{preset.label}</span>
                    <small title={preset.items}>{preset.items}</small>
                  </button>
                ))}
              </div>
            )}
          </section>

          <section className="panel">
            <div className="panel-header">
              <h2>Recent presets</h2>
              <p>Saved from your most recent price or history searches.</p>
              <button
                type="button"
                className="collapse-toggle"
                onClick={() => togglePresetPanel("recent")}
              >
                {presetPanels.recent ? "Collapse" : "Expand"}
              </button>
            </div>
            {presetPanels.recent && (
              <div className="preset-grid">
                {recentPresets.length === 0 && (
                  <div className="preset-empty">No recent searches yet.</div>
                )}
                {recentPresets.map((preset) => (
                  <button
                    key={preset.items}
                    type="button"
                    className="preset"
                    onClick={() => quickLoad(preset.items)}
                    title={preset.items}
                  >
                    <span>Recent</span>
                    <small title={preset.items}>{preset.items}</small>
                  </button>
                ))}
              </div>
            )}
          </section>
        </aside>
      </div>

      <footer className="footer">
        <div>
          <h3>Notes</h3>
          <p>
            Item IDs follow Albion Online naming conventions. Use comma-separated
            lists for multi-item queries. Location names must match in-game city
            names.
          </p>
        </div>
        <div>
          <h3>What to try next</h3>
          <p>
            Compare the same item across regions, or switch the time scale to see
            short-term demand shifts.
          </p>
        </div>
      </footer>
    </div>
  );
}
