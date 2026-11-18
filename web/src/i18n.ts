// Russian / English. The interface is written in English; after each render translateTree() swaps
// the texts it knows (whole phrases first, then the patterns of composed texts). The drawing of the
// units (SVG) keeps the names printed on the device and the MIDI labels.

export type Lang = 'en' | 'ru';

const KEY = 'jambopad.lang';
export let lang: Lang = (() => {
  try {
    const v = localStorage.getItem(KEY);
    if (v === 'en' || v === 'ru') return v;
  } catch { /* no storage */ }
  return typeof navigator !== 'undefined' && navigator.language?.toLowerCase().startsWith('ru') ? 'ru' : 'en';
})();

export function setLang(l: Lang) {
  lang = l;
  try { localStorage.setItem(KEY, l); } catch { /* no storage */ }
  document.documentElement.lang = l;
}

const RU: Record<string, string> = {
  // tabs, header
  DEVICE: 'УСТРОЙСТВО', LAYOUT: 'РАСКЛАДКА', SENSITIVITY: 'СИЛА УДАРА', PROFILES: 'ПРОФИЛИ',
  SAVE: 'СОХРАНИТЬ', SAVED: 'СОХРАНЕНО', 'not connected': 'не подключено', offline: 'не подключён',
  // device page
  CONNECT: 'ПОДКЛЮЧЕНИЕ', 'FIND PADS': 'НАЙТИ ПЭДЫ', BLUETOOTH: 'BLUETOOTH', 'VIRTUAL PADS': 'ВИРТУАЛЬНЫЕ ПЭДЫ',
  'FIND PADS: USB cable (both pads at once: a USB-C hub with power). BLUETOOTH: settings without a cable; the firmware is written over USB only.':
    'НАЙТИ ПЭДЫ — по кабелю USB (оба пэда сразу — через USB-C хаб с питанием). BLUETOOTH — настройка без кабеля; прошивка пишется только по USB.',
  'No other MIDI devices. Plug a pad in and tap FIND PADS again.': 'Других MIDI-устройств нет. Подключите пэд и снова нажмите НАЙТИ ПЭДЫ.',
  'LEFT UNIT': 'ЛЕВЫЙ БЛОК', 'RIGHT UNIT': 'ПРАВЫЙ БЛОК',
  'Not connected. Its profiles can still be edited and exported (PROFILES).': 'Не подключён. Его профили можно править и экспортировать (ПРОФИЛИ).',
  SIDE: 'СТОРОНА', LEFT: 'ЛЕВЫЙ', RIGHT: 'ПРАВЫЙ', BOTH: 'ОБА', SHOW: 'ПОКАЗАТЬ',
  'LEFT: turned by 180°, to the left of the other unit': 'ЛЕВЫЙ — повёрнут на 180°, стоит слева от второго блока',
  'Bluetooth MIDI and settings without a cable; off saves the battery': 'Bluetooth MIDI и настройка без кабеля; выключенный бережёт батарею',
  'MIDI OUT (3.5 mm)': 'MIDI OUT (3,5 мм)', 'FROM THE APP': 'ИЗ ПРИЛОЖЕНИЯ', CLOCK: 'КЛОК', ALL: 'ВСЁ', OFF: 'ВЫКЛ',
  'CLOCK: clock, start and stop from JAMbo (SYNC → MIDI CLOCK → SEND, CLOCK OUTPUT: ALL OUTPUTS); ALL: everything the app sends to this pad':
    'КЛОК — клок, старт и стоп из JAMbo (SYNC → MIDI CLOCK → SEND, CLOCK OUTPUT: ALL OUTPUTS); ВСЁ — всё, что приложение шлёт этому пэду',
  'PAD MESSAGES': 'СООБЩЕНИЯ ПЭДА', 'the pads, buttons and knobs also go to MIDI OUT': 'пэды, кнопки и ручки тоже идут в MIDI OUT',
  'TRS type A or B is the wiring inside the pad, not a setting: use the matching adapter (or a switchable one).':
    'Тип TRS A или B — это проводка внутри пэда, а не настройка: нужен переходник того же типа (или переключаемый).',
  DISCONNECT: 'ОТКЛЮЧИТЬ', 'UPDATE FIRMWARE': 'ОБНОВИТЬ ПРОШИВКУ', FIRMWARE: 'ПРОШИВКА',
  'The pad restarts into its bootloader (the SHIFT light blinks). Tap CONNECT BOOTLOADER and pick “SMC-PAD bootloader”.':
    'Пэд перезапускается в загрузчик (мигает подсветка SHIFT). Нажмите ПОДКЛЮЧИТЬ ЗАГРУЗЧИК и выберите «SMC-PAD bootloader».',
  'CONNECT BOOTLOADER': 'ПОДКЛЮЧИТЬ ЗАГРУЗЧИК', CANCEL: 'ОТМЕНА',
  'PAD IN BOOTLOADER: WRITE FIRMWARE': 'ПЭД В ЗАГРУЗЧИКЕ: ЗАПИСАТЬ ПРОШИВКУ', 'FROM FILE…': 'ИЗ ФАЙЛА…',
  'A connected pad: UPDATE FIRMWARE in its card. A pad that does not start: hold SHIFT + PLAY while switching it on (bootloader), then WRITE FIRMWARE.':
    'Подключённый пэд — ОБНОВИТЬ ПРОШИВКУ в его карточке. Пэд не запускается — держите SHIFT + PLAY при включении (загрузчик), затем ЗАПИСАТЬ ПРОШИВКУ.',
  'Done: the pad restarts with the new firmware. Connect it again in a few seconds.': 'Готово: пэд перезапускается с новой прошивкой. Подключите его снова через несколько секунд.',
  'FIRST INSTALL (STOCK FIRMWARE)': 'ПЕРВАЯ УСТАНОВКА (ЗАВОДСКАЯ ПРОШИВКА)',
  'Once per pad. Replaces the stock firmware with the open-smc-pad bootloader, then writes JAMboPAD. Pad charged or on USB power, do not unplug it while writing. CHECK reads the pad and writes nothing.':
    'Один раз на пэд. Заменяет заводскую прошивку загрузчиком open-smc-pad, затем пишет JAMboPAD. Пэд заряжен или на питании USB, во время записи не отключать. ПРОВЕРКА только читает пэд и ничего не пишет.',
  CHECK: 'ПРОВЕРКА', INSTALL: 'УСТАНОВИТЬ', 'PAD RESTARTED: WRITE FIRMWARE': 'ПЭД ПЕРЕЗАПУЩЕН: ЗАПИСАТЬ ПРОШИВКУ',
  'Now switch the pad OFF and ON again. The installer replaces the stock firmware (a few seconds), then the SHIFT light blinks: the bootloader is waiting.':
    'Теперь выключите и снова включите пэд. Установщик заменит заводскую прошивку (несколько секунд), затем замигает SHIFT — загрузчик ждёт.',
  'check only: nothing was written': 'только проверка: ничего не записано', 'directory and cfg_tool.bin as expected': 'каталог и cfg_tool.bin такие, как нужно',
  'writing the installer and the staging area…': 'пишу установщик и промежуточную область…', 'read back OK': 'чтение после записи — совпадает', 'sector 0 OK': 'сектор 0 — готово',
  // layout
  'Tap a control to edit it. Changes go to the pads at once; SAVE writes them to their memory.':
    'Тапните элемент, чтобы настроить его. Изменения сразу уходят в пэды; СОХРАНИТЬ записывает их в память.',
  'IDENTIFY: touch a control on a pad — it lights up here. Check that the drawing matches the device.':
    'ОПОЗНАТЬ: нажмите элемент на пэде — он подсветится здесь. Проверьте, что схема совпадает с устройством.',
  IDENTIFY: 'ОПОЗНАТЬ', 'Virtual pad:': 'Виртуальный пэд:', HIT: 'УДАР', TURN: 'ПОВОРОТ', PRESS: 'НАЖАТЬ',
  MESSAGE: 'СООБЩЕНИЕ', NOTE: 'НОТА', ACTION: 'ДЕЙСТВИЕ', CHANNEL: 'КАНАЛ', 'CC NUMBER': 'НОМЕР CC', PROGRAM: 'ПРОГРАММА',
  MODE: 'РЕЖИМ', MOMENTARY: 'ПОКА НАЖАТА', TOGGLE: 'ВКЛ / ВЫКЛ', MIN: 'МИН', MAX: 'МАКС', SPEED: 'СКОРОСТЬ',
  'min > max: inverted': 'мин > макс — наоборот', 'steps per click': 'шагов на щелчок',
  ABSOLUTE: 'АБСОЛЮТНЫЙ', 'REL OFFSET 64': 'ОТНОС. OFFSET 64', "REL 2'S COMPL.": 'ОТНОС. 2’S COMPL.', 'REL SIGNED BIT': 'ОТНОС. SIGNED BIT',
  'IDLE COLOR': 'ЦВЕТ В ПОКОЕ', 'PRESSED COLOR': 'ЦВЕТ ПРИ НАЖАТИИ', 'HOST COLOR': 'ЦВЕТ ОТ ПРИЛОЖЕНИЯ', 'when the app lights it': 'когда его зажигает приложение',
  'APPLY TO LAYER': 'НА ВЕСЬ СЛОЙ', 'NUMBER PADS FROM HERE': 'НУМЕРОВАТЬ ОТСЮДА',
  LAYER: 'СЛОЙ', 'OCTAVE UP': 'ОКТАВА ВВЕРХ', 'OCTAVE DOWN': 'ОКТАВА ВНИЗ', 'KEY NOTE (HOLD)': 'ТОНИКА (УДЕРЖАНИЕ)', 'PROFILE (BANK)': 'ПРОФИЛЬ (БАНК)', 'SCALE (HOLD)': 'ГАММА (УДЕРЖАНИЕ)', PROFILE: 'ПРОФИЛЬ',
  'switches the pads to this layer': 'переключает пэды на этот слой',
  'Hold the button: the three lower rows of pads are C … B, the key note is lit; tap a pad to pick it. The pad tells the app.':
    'Держите кнопку: три нижних ряда пэдов — C … B, тоника подсвечена; тап по пэду выбирает её. Пэд сообщает её приложению.',
  'Hold the button: the 11 lowest pads are the scales (Major, Minor, Dorian, Phrygian, Lydian, Mixolydian, Locrian, Harm Minor, Pent Major, Pent Minor, Chromatic — from the bottom-left), the current one is lit; tap a pad to pick it. The pad tells the app.':
    'Держите кнопку: 11 нижних пэдов — гаммы (мажор, минор, дорийская, фригийская, лидийская, миксолидийская, локрийская, гармонический минор, пентатоника мажор, пентатоника минор, хроматическая — от левого нижнего), текущая подсвечена; тап по пэду выбирает её. Пэд сообщает её приложению.',
  'Switches Bluetooth on and off; the button is lit while it is on.': 'Включает и выключает Bluetooth; кнопка горит, пока он включён.',
  'a bank of settings: layout, sensitivity, layers': 'банк настроек: раскладка, чувствительность, слои',
  TYPE: 'ТИП', CUSTOM: 'СВОЙ', KEYS: 'КЛАВИШИ', 'layer 1 is always there': 'слой 1 есть всегда',
  'set a button to ACTION → LAYER to pick it': 'чтобы выбирать его, назначьте кнопке ДЕЙСТВИЕ → СЛОЙ',
  'START LAYER': 'СТАРТОВЫЙ СЛОЙ', 'the pads show it after power-up and profile change': 'пэды показывают его после включения и смены профиля',
  'JAMbo: MIDI → NOTES': 'JAMbo: MIDI → NOTES', CHROMATIC: 'ХРОМАТИКА', 'IN KEY': 'В ГАММЕ',
  'only the notes of the scale': 'только ноты гаммы', 'all notes, the scale lit (as MPC)': 'все ноты, гамма подсвечена (как в MPC)',
  'ROW STEP': 'ШАГ РЯДА', 'scale degrees per row': 'ступеней гаммы на ряд', 'semitones per row (4 = MPC, 5 = fourths)': 'полутонов на ряд (4 — как MPC, 5 — кварты)',
  'ROOT COLOR': 'ЦВЕТ ТОНИКИ', 'SCALE COLOR': 'ЦВЕТ ГАММЫ', 'OUT OF SCALE': 'ВНЕ ГАММЫ', SCALE: 'ГАММА',
  'FOLLOW JAMbo': 'КАК В JAMbo', 'the app sends its scale, key note and octave': 'приложение присылает гамму, тонику и октаву',
  'KEY NOTE': 'ТОНИКА', OCTAVE: 'ОКТАВА', 'SEND THIS SCALE TO THE PAD': 'ОТПРАВИТЬ ГАММУ В ПЭД',
  LOCAL: 'В ПЭДЕ', HOST: 'ОТ ПРИЛОЖЕНИЯ',
  // palette
  WHITE: 'БЕЛЫЙ', RED: 'КРАСНЫЙ', 'ORANGE-RED': 'КРАСНО-ОРАНЖЕВЫЙ', ORANGE: 'ОРАНЖЕВЫЙ', YELLOW: 'ЖЁЛТЫЙ', LIME: 'САЛАТОВЫЙ',
  GREEN: 'ЗЕЛЁНЫЙ', MINT: 'МЯТНЫЙ', CYAN: 'БИРЮЗОВЫЙ', SKY: 'ГОЛУБОЙ', BLUE: 'СИНИЙ', INDIGO: 'ИНДИГО', VIOLET: 'ФИОЛЕТОВЫЙ',
  MAGENTA: 'ПУРПУРНЫЙ', PINK: 'РОЗОВЫЙ',
  // scales
  Major: 'Мажор', Minor: 'Минор', Dorian: 'Дорийский', Phrygian: 'Фригийский', Lydian: 'Лидийский', Mixolydian: 'Миксолидийский',
  Locrian: 'Локрийский', 'Harm Minor': 'Гармонический минор', 'Pent Major': 'Пентатоника мажор', 'Pent Minor': 'Пентатоника минор', Chromatic: 'Хроматическая',
  // sensitivity
  'VELOCITY CURVE': 'КРИВАЯ СИЛЫ УДАРА', LINEAR: 'ЛИНЕЙНАЯ', SOFT: 'МЯГКАЯ', HARD: 'ЖЁСТКАЯ', EXP: 'ЭКСП', LOG: 'ЛОГ', 'S-CURVE': 'S-КРИВАЯ',
  FIXED: 'ПОСТОЯННАЯ', 'Drag the yellow points up and down.': 'Двигайте жёлтые точки вверх и вниз.',
  'FIXED VELOCITY': 'ПОСТОЯННАЯ СИЛА', 'VELOCITY MIN': 'СИЛА МИН', 'VELOCITY MAX': 'СИЛА МАКС', PADS: 'ПЭДЫ',
  'ON THRESHOLD': 'ПОРОГ НАЖАТИЯ', 'lower = more sensitive': 'ниже — чувствительнее', 'OFF THRESHOLD': 'ПОРОГ ОТПУСКАНИЯ',
  'FULL SCALE': 'ПОЛНАЯ СИЛА', 'peak for velocity 127': 'пик для силы 127', ATTACK: 'АТАКА', 'ms to find the peak': 'мс на поиск пика',
  'Connect a device to see live pressure.': 'Подключите пэд, чтобы видеть давление вживую.',
  'tap a pad above to pick it': 'выберите пэд тапом выше', 'AUTO CALIBRATE': 'АВТОКАЛИБРОВКА', FINISH: 'ГОТОВО',
  AFTERTOUCH: 'AFTERTOUCH', POLY: 'POLY', THRESHOLD: 'ПОРОГ', INTERVAL: 'ИНТЕРВАЛ', 'ms between messages': 'мс между сообщениями',
  'hit strength →': 'сила удара →', 'velocity →': 'сила (velocity) →',
  // profiles
  'On the device: hold PAD BANK + KNOB BANK and tap a pad of the top row to switch profiles 1–4.':
    'На пэде: держите PAD BANK + KNOB BANK и нажмите пэд верхнего ряда — профили 1–4.',
  ACTIVE: 'АКТИВНЫЙ', 'MAKE ACTIVE': 'СДЕЛАТЬ АКТИВНЫМ', EDITING: 'ПРАВИТСЯ', EDIT: 'ПРАВИТЬ', 'COPY TO…': 'КОПИРОВАТЬ В…',
  RESET: 'СБРОС', EXPORT: 'ЭКСПОРТ', IMPORT: 'ИМПОРТ', name: 'имя',
  // errors and questions
  'no answer from the device': 'устройство не отвечает', 'the port is gone': 'порт пропал', 'no firmware in this build of the page': 'в этой сборке страницы нет прошивки',
  'not a JAMboPAD profile': 'это не профиль JAMboPAD', 'unknown profile format': 'неизвестный формат профиля',
  'the installer images are not in this build of the page': 'в этой сборке страницы нет образов установщика', 'the installer images are damaged': 'образы установщика повреждены',
  'no “SMC-PAD-Private” MIDI port: is the pad with the stock firmware plugged in?': 'нет MIDI-порта «SMC-PAD-Private»: подключён ли пэд с заводской прошивкой?',
  'the stock firmware does not answer on its Private MIDI port': 'заводская прошивка не отвечает на своём порту Private',
  'not an SMC-PAD': 'это не SMC-PAD', 'restored the original sector 0': 'исходный сектор 0 восстановлен',
  'read-back mismatch in free flash (sector 0 untouched, nothing to undo)': 'после записи в свободную память данные не совпали (сектор 0 не тронут, отменять нечего)',
  'COULD NOT RESTORE SECTOR 0 — do not switch the pad off; keep this page open and ask': 'НЕ УДАЛОСЬ ВОССТАНОВИТЬ СЕКТОР 0 — не выключайте пэд, не закрывайте страницу и напишите разработчику',
  'Install the bootloader over the stock firmware? Going back to the stock firmware later needs extra hardware (a Raspberry Pi Pico).':
    'Установить загрузчик вместо заводской прошивки? Вернуть заводскую прошивку потом можно только с дополнительной платой (Raspberry Pi Pico).',
  'Load the JAMbo layout for this side into all 4 profiles of this unit? (Its profiles are replaced.)':
    'Загрузить раскладку JAMbo для этой стороны во все 4 профиля блока? (Его профили будут заменены.)',
  'This connection is Bluetooth: switching it off disconnects. Go on?': 'Это подключение по Bluetooth: выключение его разорвёт. Продолжить?',
};

// composed texts: [pattern, replacement]
const RU_PATTERNS: [RegExp, string | ((...m: string[]) => string)][] = [
  [/^LEFT · LAYER (\d)$/, 'ЛЕВЫЙ · СЛОЙ $1'],
  [/^RIGHT · LAYER (\d)$/, 'ПРАВЫЙ · СЛОЙ $1'],
  [/^(LEFT|RIGHT) · LAYER (\d) · PAD row (\d), column (\d)$/, (_, s, l, r, c) => `${s === 'LEFT' ? 'ЛЕВЫЙ' : 'ПРАВЫЙ'} · СЛОЙ ${l} · ПЭД ряд ${r}, столбец ${c}`],
  [/^(LEFT|RIGHT) · BUTTON (.+)$/, (_, s, b) => `${s === 'LEFT' ? 'ЛЕВЫЙ' : 'ПРАВЫЙ'} · КНОПКА ${b}`],
  [/^(LEFT|RIGHT) · KNOB row (\d), column (\d)$/, (_, s, r, c) => `${s === 'LEFT' ? 'ЛЕВЫЙ' : 'ПРАВЫЙ'} · РУЧКА ряд ${r}, столбец ${c}`],
  [/^LAYER (\d)( KEYS)?$/, (_, n, k) => `СЛОЙ ${n}${k ? ' КЛАВИШИ' : ''}`],
  [/^PROFILE (\d)$/, 'ПРОФИЛЬ $1'],
  [/^LED MODE · (LEFT|RIGHT)$/, (_, s) => `ПОДСВЕТКА · ${s === 'LEFT' ? 'ЛЕВЫЙ' : 'ПРАВЫЙ'}`],
  [/^GAIN · PAD (\d+)$/, 'УСИЛЕНИЕ · ПЭД $1'],
  [/^picked by (.+)$/, 'выбирается кнопкой $1'],
  [/^lowest note (.+)$/, 'нижняя нота $1'],
  [/^(LEFT|RIGHT) \(offline\)$/, (_, s) => `${s === 'LEFT' ? 'ЛЕВЫЙ' : 'ПРАВЫЙ'} (не подключён)`],
  [/^Writing… (\d+)% — do not unplug the pad\.$/, 'Запись… $1% — не отключайте пэд.'],
  [/^pad (\d+): peak (\d+) → (\d+) → velocity (\d+)$/, 'пэд $1: пик $2 → $3 → сила $4'],
  [/^Hit every pad as hard as you can \((\d+)\/16\), then FINISH\.$/, 'Ударьте по каждому пэду как можно сильнее ($1/16), затем ГОТОВО.'],
  [/^(.+) · firmware (.+) · profile (\d) active$/, '$1 · прошивка $2 · активен профиль $3'],
  [/^MIDI ports: (.*)$/, 'MIDI-порты: $1'],
  [/^This browser has no (.+)\. Use Chrome on Android \(or on a computer\)\. Safari and every browser on iPad cannot talk to the pads; the virtual pads work everywhere\.$/,
    'В этом браузере нет $1. Откройте страницу в Chrome на Android (или на компьютере). Safari и все браузеры на iPad не могут работать с пэдами; виртуальные пэды работают везде.'],
  [/^(.+) does not answer: it probably runs the stock firmware\. Install the JAMboPAD firmware first \(FIRST INSTALL below\)\.$/,
    '$1 не отвечает: скорее всего, на нём заводская прошивка. Сначала установите JAMboPAD (ПЕРВАЯ УСТАНОВКА ниже).'],
  [/^Reset profile (\d) to the JAMbo layout\?$/, 'Сбросить профиль $1 к раскладке JAMbo?'],
  [/^Both units are set to (LEFT|RIGHT): change the side of one of them \(DEVICE\)\.$/, (_, s) => `Оба блока — ${s === 'LEFT' ? 'ЛЕВЫЕ' : 'ПРАВЫЕ'}: смените сторону у одного из них (УСТРОЙСТВО).`],
  [/^device: (.+)$/, 'устройство: $1'],
  [/^(.+): this pad's firmware is not the one the installer was built for\. Nothing was written\.$/, '$1: прошивка этого пэда не та, под которую собран установщик. Ничего не записано.'],
  [/^cfg_tool\.bin differs from the one the installer was built with\. Nothing was written\.$/, 'cfg_tool.bin отличается от того, с которым собран установщик. Ничего не записано.'],
  [/^stock firmware (.+)$/, 'заводская прошивка $1'],
  [/^(.+) · editing$/, '$1 · правится'],
];

export function t(s: string): string {
  if (lang === 'en') return s;
  const exact = RU[s];
  if (exact) return exact;
  for (const [re, rep] of RU_PATTERNS) {
    if (re.test(s)) return s.replace(re, rep as string);
  }
  return s;
}

// translates the texts and the titles under root, except inside the drawings of the units
export function translateTree(root: HTMLElement) {
  if (lang === 'en') return;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode: (n) => (n.parentElement?.closest('svg') ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT),
  });
  const nodes: Text[] = [];
  while (walker.nextNode()) nodes.push(walker.currentNode as Text);
  for (const n of nodes) {
    const raw = n.data, s = raw.trim();
    if (!s) continue;
    const r = t(s);
    if (r !== s) n.data = raw.replace(s, r);
  }
  root.querySelectorAll<HTMLElement>('[title], [placeholder], [aria-label]').forEach((el) => {
    for (const a of ['title', 'placeholder', 'aria-label']) {
      const v = el.getAttribute(a);
      if (v) el.setAttribute(a, t(v));
    }
  });
}
