const HOSTS = {
  Americas: "https://west.albion-online-data.com",
  Europe: "https://europe.albion-online-data.com",
  Asia: "https://east.albion-online-data.com"
};

const API_PATH = "/api/v2/stats";

const toCsv = (value) =>
  value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean)
    .join(",");

const withParams = (url, params) => {
  const query = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value === undefined || value === null || value === "") {
      return;
    }
    query.set(key, value);
  });
  const suffix = query.toString();
  return suffix ? `${url}?${suffix}` : url;
};

const normalizeDate = (value) => {
  if (!value) return value;
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const [year, month, day] = value.split("-");
    return `${Number(month)}-${Number(day)}-${year}`;
  }
  return value;
};

export const getHost = (regionLabel) => HOSTS[regionLabel] ?? HOSTS.Americas;

export const buildPricesUrl = ({ region, items, locations, qualities }) => {
  const itemCsv = toCsv(items);
  if (!itemCsv) {
    throw new Error("Add at least one item id to fetch prices.");
  }
  const base = `${getHost(region)}${API_PATH}/prices/${itemCsv}.json`;
  return withParams(base, {
    locations: toCsv(locations),
    qualities: toCsv(qualities)
  });
};

export const buildHistoryUrl = ({
  region,
  items,
  locations,
  qualities,
  date,
  endDate,
  timeScale
}) => {
  const itemCsv = toCsv(items);
  if (!itemCsv) {
    throw new Error("Add at least one item id to fetch history.");
  }
  const base = `${getHost(region)}${API_PATH}/history/${itemCsv}.json`;
  return withParams(base, {
    locations: toCsv(locations),
    qualities: toCsv(qualities),
    date: normalizeDate(date),
    end_date: normalizeDate(endDate),
    "time-scale": timeScale
  });
};

export const buildGoldUrl = ({ region, count }) => {
  const base = `${getHost(region)}${API_PATH}/gold.json`;
  return withParams(base, { count });
};

export const fetchJson = async (url) => {
  const response = await fetch(url);
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Request failed (${response.status}): ${body.slice(0, 140)}`);
  }
  return response.json();
};

export { HOSTS };
