(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.WorldClockLogic = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  var CITIES = [
    { tz: 'Asia/Shanghai', zh: '北京', en: 'Beijing', country: '中国', flag: '🇨🇳' },
    { tz: 'Asia/Shanghai', zh: '上海', en: 'Shanghai', country: '中国', flag: '🇨🇳' },
    { tz: 'Asia/Taipei', zh: '台北', en: 'Taipei', country: '中国', flag: '🇨🇳' },
    { tz: 'Asia/Hong_Kong', zh: '香港', en: 'Hong Kong', country: '中国', flag: '🇨🇳' },
    { tz: 'Asia/Macau', zh: '澳门', en: 'Macau', country: '中国', flag: '🇨🇳' },
    { tz: 'Asia/Tokyo', zh: '东京', en: 'Tokyo', country: '日本', flag: '🇯🇵' },
    { tz: 'Asia/Seoul', zh: '首尔', en: 'Seoul', country: '韩国', flag: '🇰🇷' },
    { tz: 'Asia/Singapore', zh: '新加坡', en: 'Singapore', country: '新加坡', flag: '🇸🇬' },
    { tz: 'Asia/Bangkok', zh: '曼谷', en: 'Bangkok', country: '泰国', flag: '🇹🇭' },
    { tz: 'Asia/Jakarta', zh: '雅加达', en: 'Jakarta', country: '印度尼西亚', flag: '🇮🇩' },
    { tz: 'Asia/Manila', zh: '马尼拉', en: 'Manila', country: '菲律宾', flag: '🇵🇭' },
    { tz: 'Asia/Ho_Chi_Minh', zh: '胡志明市', en: 'Ho Chi Minh City', country: '越南', flag: '🇻🇳' },
    { tz: 'Asia/Kuala_Lumpur', zh: '吉隆坡', en: 'Kuala Lumpur', country: '马来西亚', flag: '🇲🇾' },
    { tz: 'Asia/Karachi', zh: '卡拉奇', en: 'Karachi', country: '巴基斯坦', flag: '🇵🇰' },
    { tz: 'Asia/Dhaka', zh: '达卡', en: 'Dhaka', country: '孟加拉国', flag: '🇧🇩' },
    { tz: 'Asia/Kolkata', zh: '新德里', en: 'New Delhi', country: '印度', flag: '🇮🇳' },
    { tz: 'Asia/Dubai', zh: '迪拜', en: 'Dubai', country: '阿联酋', flag: '🇦🇪' },
    { tz: 'Asia/Riyadh', zh: '利雅得', en: 'Riyadh', country: '沙特阿拉伯', flag: '🇸🇦' },
    { tz: 'Europe/Istanbul', zh: '伊斯坦布尔', en: 'Istanbul', country: '土耳其', flag: '🇹🇷' },
    { tz: 'Europe/Moscow', zh: '莫斯科', en: 'Moscow', country: '俄罗斯', flag: '🇷🇺' },
    { tz: 'Europe/Kyiv', zh: '基辅', en: 'Kyiv', country: '乌克兰', flag: '🇺🇦' },
    { tz: 'Europe/Warsaw', zh: '华沙', en: 'Warsaw', country: '波兰', flag: '🇵🇱' },
    { tz: 'Europe/Prague', zh: '布拉格', en: 'Prague', country: '捷克', flag: '🇨🇿' },
    { tz: 'Europe/Vienna', zh: '维也纳', en: 'Vienna', country: '奥地利', flag: '🇦🇹' },
    { tz: 'Europe/Zurich', zh: '苏黎世', en: 'Zurich', country: '瑞士', flag: '🇨🇭' },
    { tz: 'Europe/Rome', zh: '罗马', en: 'Rome', country: '意大利', flag: '🇮🇹' },
    { tz: 'Europe/Madrid', zh: '马德里', en: 'Madrid', country: '西班牙', flag: '🇪🇸' },
    { tz: 'Europe/Lisbon', zh: '里斯本', en: 'Lisbon', country: '葡萄牙', flag: '🇵🇹' },
    { tz: 'Europe/Paris', zh: '巴黎', en: 'Paris', country: '法国', flag: '🇫🇷' },
    { tz: 'Europe/Berlin', zh: '柏林', en: 'Berlin', country: '德国', flag: '🇩🇪' },
    { tz: 'Europe/Amsterdam', zh: '阿姆斯特丹', en: 'Amsterdam', country: '荷兰', flag: '🇳🇱' },
    { tz: 'Europe/London', zh: '伦敦', en: 'London', country: '英国', flag: '🇬🇧' },
    { tz: 'Europe/Dublin', zh: '都柏林', en: 'Dublin', country: '爱尔兰', flag: '🇮🇪' },
    { tz: 'Europe/Stockholm', zh: '斯德哥尔摩', en: 'Stockholm', country: '瑞典', flag: '🇸🇪' },
    { tz: 'Europe/Oslo', zh: '奥斯陆', en: 'Oslo', country: '挪威', flag: '🇳🇴' },
    { tz: 'Europe/Copenhagen', zh: '哥本哈根', en: 'Copenhagen', country: '丹麦', flag: '🇩🇰' },
    { tz: 'Europe/Helsinki', zh: '赫尔辛基', en: 'Helsinki', country: '芬兰', flag: '🇫🇮' },
    { tz: 'Europe/Athens', zh: '雅典', en: 'Athens', country: '希腊', flag: '🇬🇷' },
    { tz: 'Atlantic/Reykjavik', zh: '雷克雅未克', en: 'Reykjavik', country: '冰岛', flag: '🇮🇸' },
    { tz: 'Africa/Cairo', zh: '开罗', en: 'Cairo', country: '埃及', flag: '🇪🇬' },
    { tz: 'Africa/Lagos', zh: '拉各斯', en: 'Lagos', country: '尼日利亚', flag: '🇳🇬' },
    { tz: 'Africa/Nairobi', zh: '内罗毕', en: 'Nairobi', country: '肯尼亚', flag: '🇰🇪' },
    { tz: 'Africa/Johannesburg', zh: '约翰内斯堡', en: 'Johannesburg', country: '南非', flag: '🇿🇦' },
    { tz: 'America/New_York', zh: '纽约', en: 'New York', country: '美国', flag: '🇺🇸' },
    { tz: 'America/Chicago', zh: '芝加哥', en: 'Chicago', country: '美国', flag: '🇺🇸' },
    { tz: 'America/Los_Angeles', zh: '洛杉矶', en: 'Los Angeles', country: '美国', flag: '🇺🇸' },
    { tz: 'Pacific/Honolulu', zh: '檀香山', en: 'Honolulu', country: '美国', flag: '🇺🇸' },
    { tz: 'America/Toronto', zh: '多伦多', en: 'Toronto', country: '加拿大', flag: '🇨🇦' },
    { tz: 'America/Vancouver', zh: '温哥华', en: 'Vancouver', country: '加拿大', flag: '🇨🇦' },
    { tz: 'America/Mexico_City', zh: '墨西哥城', en: 'Mexico City', country: '墨西哥', flag: '🇲🇽' },
    { tz: 'America/Bogota', zh: '波哥大', en: 'Bogota', country: '哥伦比亚', flag: '🇨🇴' },
    { tz: 'America/Lima', zh: '利马', en: 'Lima', country: '秘鲁', flag: '🇵🇪' },
    { tz: 'America/Santiago', zh: '圣地亚哥', en: 'Santiago', country: '智利', flag: '🇨🇱' },
    { tz: 'America/Sao_Paulo', zh: '圣保罗', en: 'Sao Paulo', country: '巴西', flag: '🇧🇷' },
    { tz: 'America/Buenos_Aires', zh: '布宜诺斯艾利斯', en: 'Buenos Aires', country: '阿根廷', flag: '🇦🇷' },
    { tz: 'Australia/Sydney', zh: '悉尼', en: 'Sydney', country: '澳大利亚', flag: '🇦🇺' },
    { tz: 'Australia/Melbourne', zh: '墨尔本', en: 'Melbourne', country: '澳大利亚', flag: '🇦🇺' },
    { tz: 'Australia/Perth', zh: '珀斯', en: 'Perth', country: '澳大利亚', flag: '🇦🇺' },
    { tz: 'Australia/Brisbane', zh: '布里斯班', en: 'Brisbane', country: '澳大利亚', flag: '🇦🇺' },
    { tz: 'Pacific/Auckland', zh: '奥克兰', en: 'Auckland', country: '新西兰', flag: '🇳🇿' }
  ];

  var byId = {};
  for (var i = 0; i < CITIES.length; i++) byId[CITIES[i].zh] = CITIES[i];

  function pad2(n) { return (n < 10 ? '0' : '') + n; }

  function wallClock(tz, date) {
    var dtf = new Intl.DateTimeFormat('en-GB', {
      timeZone: tz, hour12: false,
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit'
    });
    var map = {};
    dtf.formatToParts(date).forEach(function (p) { if (p.type !== 'literal') map[p.type] = p.value; });
    return {
      year: +map.year, month: +map.month, day: +map.day,
      hour: +map.hour % 24, minute: +map.minute, second: +map.second,
      ms: date.getMilliseconds()
    };
  }

  function tzOffsetMinutes(tz, date) {
    var w = wallClock(tz, date);
    var asUTC = Date.UTC(w.year, w.month - 1, w.day, w.hour, w.minute, w.second);
    return Math.round((asUTC - Math.floor(date.getTime() / 1000) * 1000) / 60000);
  }

  function offsetLabel(min) {
    if (min === 0) return 'UTC±0';
    var sign = min > 0 ? '+' : '-';
    var abs = Math.abs(min);
    var h = Math.floor(abs / 60), m = abs % 60;
    return 'UTC' + sign + h + (m ? ':' + pad2(m) : '');
  }

  function diffLabel(offsetMin, localOffsetMin) {
    var d = (offsetMin - localOffsetMin) / 60;
    if (d === 0) return '与本地同时区';
    var sign = d > 0 ? '+' : '-';
    var abs = Math.abs(d);
    var h = Math.floor(abs), m = Math.round((abs - h) * 60);
    return '比本地 ' + sign + h + ' 小时' + (m ? ' ' + m + ' 分' : '');
  }

  function dateParts(tz, date) {
    var wd = new Intl.DateTimeFormat('zh-CN', { timeZone: tz, weekday: 'short' }).format(date);
    var dt = new Intl.DateTimeFormat('zh-CN', { timeZone: tz, month: 'long', day: 'numeric' }).format(date);
    return { weekday: wd, dateText: dt };
  }

  function readClock(tz, date, localOffsetMin) {
    var w = wallClock(tz, date);
    var offsetMin = tzOffsetMinutes(tz, date);
    var dp = dateParts(tz, date);
    return {
      hour: w.hour, minute: w.minute, second: w.second, ms: w.ms,
      offsetMin: offsetMin, isDay: w.hour >= 6 && w.hour < 18,
      weekday: dp.weekday, dateText: dp.dateText,
      offsetText: offsetLabel(offsetMin), diffText: diffLabel(offsetMin, localOffsetMin)
    };
  }

  function digital(c, hour12) {
    var h = c.hour, suffix = '';
    if (hour12) {
      suffix = h >= 12 ? ' PM' : ' AM';
      h = h % 12; if (h === 0) h = 12;
    }
    return (hour12 ? String(h) : pad2(h)) + ':' + pad2(c.minute) + ':' + pad2(c.second) + suffix;
  }

  function analogAngles(c) {
    var s = c.second + c.ms / 1000;
    var m = c.minute + s / 60;
    var h = (c.hour % 12) + m / 60;
    return { hour: h * 30, minute: m * 6, second: s * 6 };
  }

  function searchCities(q) {
    q = (q || '').trim().toLowerCase();
    if (!q) return [];
    var out = [];
    for (var i = 0; i < CITIES.length; i++) {
      var c = CITIES[i];
      if (c.zh.indexOf(q) >= 0 || c.en.toLowerCase().indexOf(q) >= 0 ||
        c.country.indexOf(q) >= 0 || c.tz.toLowerCase().indexOf(q) >= 0) out.push(c);
    }
    return out.slice(0, 12);
  }

  function getCity(id) { return byId[id] || null; }

  function localZone() {
    try { return Intl.DateTimeFormat().resolvedOptions().timeZone; }
    catch (e) { return 'UTC'; }
  }

  function isValidZone(tz) {
    try { new Intl.DateTimeFormat('en-GB', { timeZone: tz }); return true; }
    catch (e) { return false; }
  }

  return {
    CITIES: CITIES,
    searchCities: searchCities,
    getCity: getCity,
    readClock: readClock,
    digital: digital,
    analogAngles: analogAngles,
    offsetLabel: offsetLabel,
    diffLabel: diffLabel,
    tzOffsetMinutes: tzOffsetMinutes,
    wallClock: wallClock,
    localZone: localZone,
    isValidZone: isValidZone
  };
});
