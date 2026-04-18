export interface ChainLayer {
  id: number;
  theme: string;
  name: string;
  icon: string;
  technologies: string;   // short description of what this layer makes
  color: string;          // accent / border color
  bgColor: string;        // subtle background tint (dark mode)
  symbols: string[];
}

/**
 * 7-layer AI server supply chain mapping.
 * Symbols drawn from our 66-stock universe + the full 10-layer DB.
 */
export const CHAIN_LAYERS: ChainLayer[] = [
  {
    id: 1, theme: 'A',
    name: '核心運算晶片層',
    icon: '🧠',
    technologies: 'GPU代工 · ASIC設計 · HBM記憶體 · CoWoS先進封裝 · BMC',
    color: '#9B6BD0',
    bgColor: 'rgba(155,107,208,0.08)',
    symbols: [
      '2330', // 台積電   晶圓代工
      '3711', // 日月光投控 封測
      '6147', // 頎邦     封測
      '2449', // 京元電子  測試
      '3661', // 世芯-KY  ASIC
      '3443', // 創意電子  ASIC
      '3035', // 智原     ASIC
      '2454', // 聯發科   IC設計
      '5274', // 信驊     BMC/伺服器IC
      '6531', // 愛普     記憶體IC
      '2486', // 一詮     CoWoS均熱片
      // Memory
      '2408', // 南亞科   DRAM
      '2344', // 華邦電   DRAM+NOR
      '2337', // 旺宏     NOR+NAND
      '8299', // 群聯     NAND控制
      '6770', // 力積電   DRAM代工
      '6239', // 力成     HBM封裝
    ],
  },
  {
    id: 2, theme: 'A',
    name: 'PCB 與載板層',
    icon: '🔌',
    technologies: 'ABF載板 · 伺服器主板 · CCL銅箔基板 · T-Glass玻纖布 · PCB耗材',
    color: '#52B788',
    bgColor: 'rgba(82,183,136,0.08)',
    symbols: [
      '3037', // 欣興     ABF載板
      '8046', // 南電     ABF載板
      '3189', // 景碩     BT+ABF
      '2383', // 台光電   CCL
      '6274', // 台燿     CCL
      '6213', // 聯茂     CCL
      '1815', // 富喬     T-Glass
      '1802', // 台玻     T-Glass
      '2368', // 金像電   PCB主機板
      '2313', // 華通     PCB主機板
      '3044', // 健鼎     PCB主機板
      '5469', // 瀚宇博   PCB主機板
      '8021', // 尖點     PCB鑽針
      '3167', // 大量     PCB背鑽機
      '8074', // 鉅橡     PCB墊板
      '3715', // 定穎投控  AI伺服器PCB
      // PCB 材料/化工
      '1717', // 長興     環氧樹脂/特殊化工
      '1301', // 台塑     環氧樹脂原料
      '1303', // 南亞     環氧樹脂/玻纖布
      '1313', // 聯成     環氧樹脂
      '8039', // 台虹     高頻高速基板材料
    ],
  },
  {
    id: 3, theme: 'A',
    name: '散熱與電源層',
    icon: '❄️',
    technologies: '液冷 Cold Plate · CDU · 快接頭 QDC · BBU備援電池 · HVDC電源',
    color: '#E07B3A',
    bgColor: 'rgba(224,123,58,0.08)',
    symbols: [
      '3017', // 奇鋐     散熱水冷
      '3324', // 雙鴻     散熱水冷
      '6805', // 富世達   QDC快接頭
      '3653', // 健策     MCL液冷
      '6230', // 尼得科超眾 散熱
      '2308', // 台達電   電源+HVDC
      '2301', // 光寶科   電源+HVDC
      '6781', // AES-KY  BBU電池
      '3211', // 順達     BBU電池
      '4931', // 新盛力   BBU電池
    ],
  },
  {
    id: 4, theme: 'A',
    name: '光通訊與 CPO 層',
    icon: '💡',
    technologies: '矽光子 · 光引擎封裝 · 800G/1.6T光模組 · 網通交換器 · InP磊晶',
    color: '#3A8AC7',
    bgColor: 'rgba(58,138,199,0.08)',
    symbols: [
      '2345', // 智邦     網通交換器
      '4979', // 華星光   光模組
      '6442', // 光聖     光模組
      '3450', // 聯鈞     光模組
      '4977', // 眾達-KY  ELS雷射源
      '3081', // 聯亞     InP+PAM4
      '3163', // 波若威   光被動元件
      '6451', // 訊芯-KY  光引擎封裝
      '3363', // 上詮     FAU光纖陣列
      '4991', // 環宇-KY  InP晶片代工 (AAOI)
      '3105', // 穩懋     GaAs/InP代工
      '2455', // 全新     InP磊晶
      '8086', // 宏捷科   GaAs代工
    ],
  },
  {
    id: 5, theme: 'A',
    name: '被動元件與連接器層',
    icon: '🔩',
    technologies: 'MLCC · 電感 · 高速連接器 · DAC/ACC銅纜 · 化合物半導體',
    color: '#C7A020',
    bgColor: 'rgba(199,160,32,0.08)',
    symbols: [
      '2327', // 國巨     MLCC+電阻
      '2492', // 華新科   MLCC
      '3026', // 禾伸堂   MLCC車用
      '3357', // 台慶科   TLVR電感
    ],
  },
  {
    id: 6, theme: 'A',
    name: '伺服器 ODM 組裝層',
    icon: '🖥️',
    technologies: '主機板 · L10/L11機櫃組裝 · GPU伺服器 · ASIC伺服器 · 機殼',
    color: '#C74040',
    bgColor: 'rgba(199,64,64,0.08)',
    symbols: [
      '2317', // 鴻海     ODM 52%市占
      '2382', // 廣達     Google AI
      '3231', // 緯創     AMD+Dell
      '6669', // 緯穎     100% CSP
      '2356', // 英業達   L6模組
      '8210', // 勤誠     機殼+水冷
      '2059', // 川湖     伺服器機架滑軌
      '3013', // 晟銘電   伺服器機殼
    ],
  },
  {
    id: 7, theme: 'A',
    name: '電力基礎建設層',
    icon: '⚡',
    technologies: '大型變壓器 · GIS開關設備 · 重電 · AI資料中心電網',
    color: '#20C7A0',
    bgColor: 'rgba(32,199,160,0.08)',
    symbols: [
      '1519', // 華城     大型變壓器
      '1513', // 中興電   GIS設備
      '1503', // 士電     綜合重電
      '1514', // 亞力     重電
    ],
  },
  {
    id: 11, theme: 'B',
    name: '電池材料層',
    icon: '🔋',
    technologies: '正極材料 · 電解液 · 電池化學品',
    color: '#4CAF50',
    bgColor: 'rgba(76,175,80,0.08)',
    symbols: ['4721','4739','6509'],
  },
  {
    id: 12, theme: 'B',
    name: '三電傳動層',
    icon: '⚙️',
    technologies: '電動車齒輪箱 · 傳動精密件 · 整車組裝',
    color: '#8BC34A',
    bgColor: 'rgba(139,195,74,0.08)',
    symbols: ['1536','2351','2201'],
  },
  {
    id: 13, theme: 'B',
    name: '車用線束層',
    icon: '🔗',
    technologies: 'EV高壓線束 · 車用連接器 · 線束系統',
    color: '#CDDC39',
    bgColor: 'rgba(205,220,57,0.08)',
    symbols: ['3665','3023','3003'],
  },
  {
    id: 14, theme: 'B',
    name: '車燈光學層',
    icon: '💡',
    technologies: '車用感測器 · 環景系統 · ADAS光學',
    color: '#FFC107',
    bgColor: 'rgba(255,193,7,0.08)',
    symbols: ['3552'],
  },
  {
    id: 15, theme: 'B',
    name: '充電基建層',
    icon: '⚡',
    technologies: 'EV充電樁 · 車載充電器OBC · 充電模組',
    color: '#FF9800',
    bgColor: 'rgba(255,152,0,0.08)',
    symbols: ['2457','6235','2308'],
  },
  {
    id: 21, theme: 'C',
    name: '減速機傳動層',
    icon: '⚙️',
    technologies: '諧波減速機 · 滾珠螺桿 · 線性模組',
    color: '#00BCD4',
    bgColor: 'rgba(0,188,212,0.08)',
    symbols: ['2049','1597'],
  },
  {
    id: 22, theme: 'C',
    name: '伺服馬達層',
    icon: '🔄',
    technologies: '工業伺服馬達 · 精密滾珠螺桿 · 關節驅動',
    color: '#3F51B5',
    bgColor: 'rgba(63,81,181,0.08)',
    symbols: ['1504','4540'],
  },
  {
    id: 23, theme: 'C',
    name: '機電整合層',
    icon: '🤖',
    technologies: '協作機器人 · 工業視覺 · 系統整合',
    color: '#9C27B0',
    bgColor: 'rgba(156,39,176,0.08)',
    symbols: ['2359','6188'],
  },
  {
    id: 24, theme: 'C',
    name: '感測末端層',
    icon: '👁️',
    technologies: '光學感測IC · 工業鏡頭 · 機器人視覺',
    color: '#E91E63',
    bgColor: 'rgba(233,30,99,0.08)',
    symbols: ['3227','3019'],
  },
];
