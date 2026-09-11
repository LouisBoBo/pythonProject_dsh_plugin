import { defineTool } from '@deepseek-ai/dsh-tools';
export const name = 'weather';
export const inject = ['tools'];
/** WMO Weather interpretation codes → 中文 */
function weatherCodeLabel(code) {
    const map = {
        0: '晴',
        1: '大部晴朗',
        2: '局部多云',
        3: '阴',
        45: '雾',
        48: '雾凇',
        51: '小毛毛雨',
        53: '毛毛雨',
        55: '大毛毛雨',
        61: '小雨',
        63: '中雨',
        65: '大雨',
        71: '小雪',
        73: '中雪',
        75: '大雪',
        80: '阵雨',
        81: '强阵雨',
        82: '暴雨',
        95: '雷阵雨',
        96: '雷阵雨伴冰雹',
        99: '强雷阵雨伴冰雹',
    };
    return map[code] ?? `天气代码 ${code}`;
}
async function geocodeCity(city) {
    const q = city.trim();
    if (!q)
        throw new Error('城市名不能为空');
    const url = 'https://geocoding-api.open-meteo.com/v1/search?' +
        new URLSearchParams({
            name: q,
            count: '1',
            language: 'zh',
            format: 'json',
        }).toString();
    const res = await fetch(url);
    if (!res.ok)
        throw new Error(`地理编码失败 HTTP ${res.status}`);
    const data = (await res.json());
    const hit = data.results?.[0];
    if (!hit)
        throw new Error(`找不到城市「${q}」，请换常用地名再试（如 深圳、Beijing）`);
    return hit;
}
async function fetchCurrentWeather(city) {
    const geo = await geocodeCity(city);
    const tz = geo.timezone || 'Asia/Shanghai';
    const url = 'https://api.open-meteo.com/v1/forecast?' +
        new URLSearchParams({
            latitude: String(geo.latitude),
            longitude: String(geo.longitude),
            current: 'temperature_2m,relative_humidity_2m,weather_code,wind_speed_10m',
            timezone: tz,
            wind_speed_unit: 'kmh',
        }).toString();
    const res = await fetch(url);
    if (!res.ok)
        throw new Error(`天气接口失败 HTTP ${res.status}`);
    const data = (await res.json());
    const cur = data.current;
    if (!cur || cur.temperature_2m == null)
        throw new Error('天气接口未返回实况数据');
    const code = cur.weather_code ?? -1;
    const place = [geo.name, geo.admin1, geo.country].filter(Boolean).join(' · ');
    return {
        city: place,
        latitude: geo.latitude,
        longitude: geo.longitude,
        observedAt: cur.time ?? '',
        temperatureC: cur.temperature_2m,
        humidityPercent: cur.relative_humidity_2m ?? 0,
        windSpeedKmh: cur.wind_speed_10m ?? 0,
        weatherCode: code,
        weatherText: weatherCodeLabel(code),
    };
}
async function fetchDailyForecast(city, days) {
    const geo = await geocodeCity(city);
    const n = Math.min(7, Math.max(1, Math.floor(days) || 3));
    const tz = geo.timezone || 'Asia/Shanghai';
    const url = 'https://api.open-meteo.com/v1/forecast?' +
        new URLSearchParams({
            latitude: String(geo.latitude),
            longitude: String(geo.longitude),
            daily: 'weather_code,temperature_2m_max,temperature_2m_min,precipitation_sum',
            timezone: tz,
            forecast_days: String(n),
        }).toString();
    const res = await fetch(url);
    if (!res.ok)
        throw new Error(`预报接口失败 HTTP ${res.status}`);
    const data = (await res.json());
    const daily = data.daily;
    if (!daily?.time?.length)
        throw new Error('预报接口未返回日数据');
    const place = [geo.name, geo.admin1, geo.country].filter(Boolean).join(' · ');
    const daysOut = daily.time.map((date, i) => {
        const code = daily.weather_code?.[i] ?? -1;
        return {
            date,
            weatherText: weatherCodeLabel(code),
            weatherCode: code,
            tempMaxC: daily.temperature_2m_max?.[i] ?? 0,
            tempMinC: daily.temperature_2m_min?.[i] ?? 0,
            precipitationMm: daily.precipitation_sum?.[i] ?? 0,
        };
    });
    return {
        city: place,
        days: daysOut,
    };
}
export function apply(ctx) {
    ctx.tools.register(defineTool({
        name: 'weather_query',
        description: '【查天气实况】当用户问某城市现在天气、气温、湿度、风力时必须调用。' +
            '参数 city 填城市名（中英文均可，如 深圳、上海、Beijing）。' +
            '不要凭记忆编造气温；不要用 mes_pcb 或其他工具代替。',
        parameters: {
            city: {
                type: 'string',
                required: true,
                description: '城市名称，例如 深圳、北京、Shanghai',
            },
        },
        output: {
            schema: {
                type: 'object',
                additionalProperties: false,
                properties: {
                    city: { type: 'string' },
                    latitude: { type: 'number' },
                    longitude: { type: 'number' },
                    observedAt: { type: 'string' },
                    temperatureC: { type: 'number' },
                    humidityPercent: { type: 'number' },
                    windSpeedKmh: { type: 'number' },
                    weatherCode: { type: 'number' },
                    weatherText: { type: 'string' },
                },
            },
            render: (_args, value) => [
                {
                    type: 'text',
                    text: `${value.city} 实况：${value.weatherText}，` +
                        `${value.temperatureC}°C，湿度 ${value.humidityPercent}%，` +
                        `风速 ${value.windSpeedKmh} km/h（观测时间 ${value.observedAt || '—'}）`,
                },
            ],
        },
        async execute(args) {
            return fetchCurrentWeather(args.city);
        },
    }));
    ctx.tools.register(defineTool({
        name: 'weather_forecast',
        description: '【查未来几天天气预报】当用户问某城市未来几天天气、最高最低温、会不会下雨时调用。' +
            '参数 city 为城市名；days 为预报天数 1～7，默认传 3。不要编造预报数据。',
        parameters: {
            city: {
                type: 'string',
                required: true,
                description: '城市名称，例如 深圳、北京',
            },
            days: {
                type: 'number',
                required: true,
                description: '预报天数，1～7，常用 3',
            },
        },
        output: {
            schema: {
                type: 'object',
                additionalProperties: false,
                properties: {
                    city: { type: 'string' },
                    days: {
                        type: 'array',
                        items: {
                            type: 'object',
                            additionalProperties: false,
                            properties: {
                                date: { type: 'string' },
                                weatherText: { type: 'string' },
                                weatherCode: { type: 'number' },
                                tempMaxC: { type: 'number' },
                                tempMinC: { type: 'number' },
                                precipitationMm: { type: 'number' },
                            },
                        },
                    },
                },
            },
            render: (_args, value) => {
                const lines = (value.days ?? []).map((d) => `${d.date ?? ''} ${d.weatherText ?? ''} ${d.tempMinC ?? 0}～${d.tempMaxC ?? 0}°C 降水${d.precipitationMm ?? 0}mm`);
                return [
                    {
                        type: 'text',
                        text: `${value.city} 预报：\n${lines.join('\n')}`,
                    },
                ];
            },
        },
        async execute(args) {
            return fetchDailyForecast(String(args.city), Number(args.days ?? 3));
        },
    }));
    console.log('[weather] 插件已加载，注册了 weather_query、weather_forecast 工具');
}
