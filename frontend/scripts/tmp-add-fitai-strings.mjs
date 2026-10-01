// Temporary: the FitAI / readiness labels, so the recovery numbers the session overlay reads are
// not English in every language. Deleted once it has run.
import fs from 'node:fs'

const dir = 'src/locales'

const STRINGS = {
  'Body: {0}': {
    ar: 'الجسم: {0}', de: 'Körper: {0}', es: 'Cuerpo: {0}', fr: 'Corps : {0}', hi: 'शरीर: {0}',
    hu: 'Test: {0}', it: 'Corpo: {0}', ko: '체격: {0}', pl: 'Ciało: {0}', pt: 'Corpo: {0}',
    ru: 'Тело: {0}', th: 'ร่างกาย: {0}', tr: 'Vücut: {0}', uk: 'Тіло: {0}', zh: '身体：{0}',
  },
  'Checking fuel…': {
    ar: 'جارٍ فحص الوقود…', de: 'Kraft wird geprüft…', es: 'Comprobando el combustible…',
    fr: 'Vérification des réserves…', hi: 'ईंधन जाँच रहा है…', hu: 'Készlet ellenőrzése…',
    it: 'Controllo delle scorte…', ko: '연료 확인 중…', pl: 'Sprawdzanie zapasów…',
    pt: 'A verificar as reservas…', ru: 'Проверяем запасы…', th: 'กำลังตรวจสอบพลังงาน…',
    tr: 'Yakıt kontrol ediliyor…', uk: 'Перевіряємо запаси…', zh: '正在查看能量…',
  },
  'Could not reach FitAI right now.': {
    ar: 'تعذّر الوصول إلى FitAI الآن.', de: 'FitAI ist gerade nicht erreichbar.',
    es: 'No se ha podido conectar con FitAI ahora.', fr: 'FitAI est injoignable pour le moment.',
    hi: 'अभी FitAI से संपर्क नहीं हो सका।', hu: 'A FitAI most nem érhető el.',
    it: 'Impossibile raggiungere FitAI in questo momento.', ko: '지금은 FitAI에 연결할 수 없습니다.',
    pl: 'Nie można teraz połączyć się z FitAI.', pt: 'Não foi possível contactar o FitAI agora.',
    ru: 'Сейчас не удаётся связаться с FitAI.', th: 'ขณะนี้ติดต่อ FitAI ไม่ได้',
    tr: 'Şu anda FitAI’ye ulaşılamıyor.', uk: 'Зараз не вдається зв’язатися з FitAI.',
    zh: '暂时连不上 FitAI。',
  },
  'Details live in FitAI — openGym only reads.': {
    ar: 'التفاصيل في FitAI — openGym يقرأ فقط.', de: 'Die Details liegen in FitAI — openGym liest nur.',
    es: 'Los detalles están en FitAI: openGym solo los lee.',
    fr: 'Les détails sont dans FitAI — openGym ne fait que lire.',
    hi: 'विवरण FitAI में हैं — openGym केवल पढ़ता है।',
    hu: 'A részletek a FitAI-ban vannak — az openGym csak olvas.',
    it: 'I dettagli sono su FitAI: openGym si limita a leggere.',
    ko: '세부 정보는 FitAI에 있습니다 — openGym은 읽기만 합니다.',
    pl: 'Szczegóły są w FitAI — openGym tylko odczytuje.',
    pt: 'Os detalhes estão no FitAI — o openGym só lê.',
    ru: 'Подробности в FitAI — openGym только читает.',
    th: 'รายละเอียดอยู่ที่ FitAI — openGym อ่านอย่างเดียว',
    tr: 'Ayrıntılar FitAI’de — openGym yalnızca okur.',
    uk: 'Подробиці у FitAI — openGym лише читає.', zh: '明细在 FitAI 里——openGym 只做读取。',
  },
  'Fasted {0}h — heavy sets will feel harder': {
    ar: 'صائم {0} س — المجموعات الثقيلة ستكون أصعب',
    de: '{0} h nüchtern — schwere Sätze werden sich schwerer anfühlen',
    es: '{0} h en ayunas: las series pesadas costarán más',
    fr: '{0} h à jeun — les séries lourdes seront plus dures',
    hi: '{0} घंटे उपवास — भारी सेट कठिन लगेंगे',
    hu: '{0} óra éhgyomoron — a nehéz sorok nehezebbek lesznek',
    it: '{0} h a digiuno — le serie pesanti costeranno di più',
    ko: '공복 {0}시간 — 무거운 세트는 더 힘들게 느껴집니다',
    pl: '{0} h na czczo — ciężkie serie będą trudniejsze',
    pt: '{0} h em jejum — as séries pesadas vão custar mais',
    ru: '{0} ч натощак — тяжёлые подходы дадутся труднее',
    th: 'ท้องว่าง {0} ชม. — เซ็ตหนักจะรู้สึกหนักขึ้น',
    tr: '{0} saat aç — ağır setler daha zor gelir',
    uk: '{0} год натщесерце — важкі підходи даватимуться важче',
    zh: '空腹 {0} 小时——大重量组会感觉更吃力',
  },
  'Fasting: {0}/{1} done': {
    ar: 'الصيام: {0}/{1} تم', de: 'Fasten: {0}/{1} erledigt', es: 'Ayuno: {0}/{1} completados',
    fr: 'Jeûne : {0}/{1} faits', hi: 'उपवास: {0}/{1} पूरे', hu: 'Böjt: {0}/{1} kész',
    it: 'Digiuno: {0}/{1} completati', ko: '단식: {0}/{1} 완료', pl: 'Post: {0}/{1} zrobionych',
    pt: 'Jejum: {0}/{1} concluídos', ru: 'Разгрузка: {0}/{1} выполнено',
    th: 'ถือศีลอด: ทำแล้ว {0}/{1}', tr: 'Oruç: {0}/{1} tamam', uk: 'Пост: {0}/{1} виконано',
    zh: '断食：已完成 {0}/{1}',
  },
  'Fasting: {0}/{1} done, {2} running': {
    ar: 'الصيام: {0}/{1} تم، {2} جارٍ', de: 'Fasten: {0}/{1} erledigt, {2} läuft',
    es: 'Ayuno: {0}/{1} completados, {2} en curso',
    fr: 'Jeûne : {0}/{1} faits, {2} en cours', hi: 'उपवास: {0}/{1} पूरे, {2} चल रहा है',
    hu: 'Böjt: {0}/{1} kész, {2} folyamatban', it: 'Digiuno: {0}/{1} completati, {2} in corso',
    ko: '단식: {0}/{1} 완료, {2} 진행 중', pl: 'Post: {0}/{1} zrobionych, trwa {2}',
    pt: 'Jejum: {0}/{1} concluídos, {2} a decorrer', ru: 'Разгрузка: {0}/{1} выполнено, идёт {2}',
    th: 'ถือศีลอด: ทำแล้ว {0}/{1} กำลังทำ {2}', tr: 'Oruç: {0}/{1} tamam, {2} sürüyor',
    uk: 'Пост: {0}/{1} виконано, триває {2}', zh: '断食：已完成 {0}/{1}，进行中 {2}',
  },
  'FitAI food: {0} days logged': {
    ar: 'طعام FitAI: {0} أيام مسجلة', de: 'FitAI Ernährung: {0} Tage erfasst',
    es: 'Alimentación en FitAI: {0} días registrados', fr: 'Alimentation FitAI : {0} jours saisis',
    hi: 'FitAI भोजन: {0} दिन दर्ज', hu: 'FitAI étkezés: {0} nap rögzítve',
    it: 'Alimentazione FitAI: {0} giorni registrati', ko: 'FitAI 식사: {0}일 기록',
    pl: 'FitAI jedzenie: {0} dni zapisanych', pt: 'Alimentação no FitAI: {0} dias registados',
    ru: 'Питание FitAI: записано {0} дн.', th: 'อาหาร FitAI: บันทึก {0} วัน',
    tr: 'FitAI beslenme: {0} gün kayıtlı', uk: 'Харчування FitAI: записано {0} дн.',
    zh: 'FitAI 饮食：已记录 {0} 天',
  },
  'FitAI food: {0} kcal/day avg ({1} days logged)': {
    ar: 'طعام FitAI: {0} سعرة/يوم في المتوسط ({1} أيام مسجلة)',
    de: 'FitAI Ernährung: {0} kcal/Tag im Mittel ({1} Tage erfasst)',
    es: 'Alimentación en FitAI: {0} kcal/día de media ({1} días registrados)',
    fr: 'Alimentation FitAI : {0} kcal/jour en moyenne ({1} jours saisis)',
    hi: 'FitAI भोजन: औसत {0} kcal/दिन ({1} दिन दर्ज)',
    hu: 'FitAI étkezés: átlagosan {0} kcal/nap ({1} nap rögzítve)',
    it: 'Alimentazione FitAI: media {0} kcal/giorno ({1} giorni registrati)',
    ko: 'FitAI 식사: 평균 {0} kcal/일 ({1}일 기록)',
    pl: 'FitAI jedzenie: średnio {0} kcal/dzień ({1} dni zapisanych)',
    pt: 'Alimentação no FitAI: média de {0} kcal/dia ({1} dias registados)',
    ru: 'Питание FitAI: в среднем {0} ккал/день (записано {1} дн.)',
    th: 'อาหาร FitAI: เฉลี่ย {0} kcal/วัน (บันทึก {1} วัน)',
    tr: 'FitAI beslenme: ortalama {0} kcal/gün ({1} gün kayıtlı)',
    uk: 'Харчування FitAI: у середньому {0} ккал/день (записано {1} дн.)',
    zh: 'FitAI 饮食：平均 {0} kcal/天（已记录 {1} 天）',
  },
  'FitAI food: {0} kcal/day avg vs {1} target ({2} days logged)': {
    ar: 'طعام FitAI: {0} سعرة/يوم في المتوسط مقابل هدف {1} ({2} أيام مسجلة)',
    de: 'FitAI Ernährung: {0} kcal/Tag im Mittel, Ziel {1} ({2} Tage erfasst)',
    es: 'Alimentación en FitAI: {0} kcal/día de media frente al objetivo de {1} ({2} días registrados)',
    fr: 'Alimentation FitAI : {0} kcal/jour en moyenne pour un objectif de {1} ({2} jours saisis)',
    hi: 'FitAI भोजन: औसत {0} kcal/दिन, लक्ष्य {1} ({2} दिन दर्ज)',
    hu: 'FitAI étkezés: átlagosan {0} kcal/nap, cél {1} ({2} nap rögzítve)',
    it: 'Alimentazione FitAI: media {0} kcal/giorno su un obiettivo di {1} ({2} giorni registrati)',
    ko: 'FitAI 식사: 평균 {0} kcal/일, 목표 {1} ({2}일 기록)',
    pl: 'FitAI jedzenie: średnio {0} kcal/dzień wobec celu {1} ({2} dni zapisanych)',
    pt: 'Alimentação no FitAI: média de {0} kcal/dia para um objetivo de {1} ({2} dias registados)',
    ru: 'Питание FitAI: в среднем {0} ккал/день при цели {1} (записано {2} дн.)',
    th: 'อาหาร FitAI: เฉลี่ย {0} kcal/วัน เทียบเป้าหมาย {1} (บันทึก {2} วัน)',
    tr: 'FitAI beslenme: ortalama {0} kcal/gün, hedef {1} ({2} gün kayıtlı)',
    uk: 'Харчування FitAI: у середньому {0} ккал/день проти цілі {1} (записано {2} дн.)',
    zh: 'FitAI 饮食：平均 {0} kcal/天，目标 {1}（已记录 {2} 天）',
  },
  'Glucose: {0} readings': {
    ar: 'الجلوكوز: {0} قراءات', de: 'Glukose: {0} Messungen', es: 'Glucosa: {0} lecturas',
    fr: 'Glycémie : {0} mesures', hi: 'ग्लूकोज़: {0} रीडिंग', hu: 'Glükóz: {0} mérés',
    it: 'Glicemia: {0} misurazioni', ko: '혈당: {0}회 측정', pl: 'Glukoza: {0} pomiarów',
    pt: 'Glicose: {0} leituras', ru: 'Глюкоза: {0} измерений', th: 'กลูโคส: บันทึก {0} ครั้ง',
    tr: 'Glukoz: {0} ölçüm', uk: 'Глюкоза: {0} вимірів', zh: '血糖：{0} 次读数',
  },
  'Fuel': {
    ar: 'الوقود', de: 'Kraft', es: 'Combustible', fr: 'Réserves', hi: 'ईंधन', hu: 'Készlet',
    it: 'Scorte', ko: '연료', pl: 'Paliwo', pt: 'Combustível', ru: 'Топливо', th: 'พลังงาน',
    tr: 'Yakıt', uk: 'Паливо', zh: '能量',
  },
  'Fuel: {0}': {
    ar: 'الوقود: {0}', de: 'Kraft: {0}', es: 'Combustible: {0}', fr: 'Réserves : {0}',
    hi: 'ईंधन: {0}', hu: 'Készlet: {0}', it: 'Scorte: {0}', ko: '연료: {0}', pl: 'Paliwo: {0}',
    pt: 'Combustível: {0}', ru: 'Топливо: {0}', th: 'พลังงาน: {0}', tr: 'Yakıt: {0}',
    uk: 'Паливо: {0}', zh: '能量：{0}',
  },
  'No food logs in the last 7 days.': {
    ar: 'لا سجلات طعام في آخر 7 أيام.', de: 'Keine Ernährungseinträge in den letzten 7 Tagen.',
    es: 'Sin registros de alimentación en los últimos 7 días.',
    fr: 'Aucun repas enregistré sur les 7 derniers jours.',
    hi: 'पिछले 7 दिनों में कोई भोजन लॉग नहीं।',
    hu: 'Nincs étkezési bejegyzés az utóbbi 7 napban.',
    it: 'Nessun pasto registrato negli ultimi 7 giorni.',
    ko: '최근 7일 동안 식사 기록이 없습니다.', pl: 'Brak zapisów jedzenia z ostatnich 7 dni.',
    pt: 'Sem registos de alimentação nos últimos 7 dias.',
    ru: 'Нет записей о питании за последние 7 дней.',
    th: 'ไม่มีบันทึกอาหารใน 7 วันหลัง', tr: 'Son 7 günde yemek kaydı yok.',
    uk: 'Немає записів про харчування за останні 7 днів.', zh: '最近 7 天没有饮食记录。',
  },
  'Prefilled from FitAI': {
    ar: 'مملوء من FitAI', de: 'Aus FitAI vorbefüllt', es: 'Rellenado desde FitAI',
    fr: 'Prérempli depuis FitAI', hi: 'FitAI से पहले से भरा गया', hu: 'FitAI-ból előtöltve',
    it: 'Precompilato da FitAI', ko: 'FitAI에서 미리 채움', pl: 'Wypełnione z FitAI',
    pt: 'Pré-preenchido pelo FitAI', ru: 'Заполнено из FitAI', th: 'กรอกจาก FitAI',
    tr: 'FitAI’den önceden dolduruldu', uk: 'Заповнено з FitAI', zh: '已从 FitAI 预填',
  },
  'Protein: {0}g/day avg': {
    ar: 'البروتين: {0}غ/يوم في المتوسط', de: 'Protein: {0} g/Tag im Mittel',
    es: 'Proteína: {0} g/día de media', fr: 'Protéines : {0} g/jour en moyenne',
    hi: 'प्रोटीन: औसत {0} ग्राम/दिन', hu: 'Fehérje: átlagosan {0} g/nap',
    it: 'Proteine: media {0} g/giorno', ko: '단백질: 평균 {0} g/일',
    pl: 'Białko: średnio {0} g/dzień', pt: 'Proteína: média de {0} g/dia',
    ru: 'Белок: в среднем {0} г/день', th: 'โปรตีน: เฉลี่ย {0} กรัม/วัน',
    tr: 'Protein: ortalama {0} g/gün', uk: 'Білок: у середньому {0} г/день',
    zh: '蛋白质：平均 {0} 克/天',
  },
  'Protein: {0}g/day avg vs {1}g target': {
    ar: 'البروتين: {0}غ/يوم في المتوسط مقابل هدف {1}غ',
    de: 'Protein: {0} g/Tag im Mittel, Ziel {1} g',
    es: 'Proteína: {0} g/día de media frente al objetivo de {1} g',
    fr: 'Protéines : {0} g/jour en moyenne pour un objectif de {1} g',
    hi: 'प्रोटीन: औसत {0} ग्राम/दिन, लक्ष्य {1} ग्राम',
    hu: 'Fehérje: átlagosan {0} g/nap, cél {1} g',
    it: 'Proteine: media {0} g/giorno su un obiettivo di {1} g',
    ko: '단백질: 평균 {0} g/일, 목표 {1} g',
    pl: 'Białko: średnio {0} g/dzień wobec celu {1} g',
    pt: 'Proteína: média de {0} g/dia para um objetivo de {1} g',
    ru: 'Белок: в среднем {0} г/день при цели {1} г',
    th: 'โปรตีน: เฉลี่ย {0} กรัม/วัน เทียบเป้าหมาย {1} กรัม',
    tr: 'Protein: ortalama {0} g/gün, hedef {1} g',
    uk: 'Білок: у середньому {0} г/день проти цілі {1} г',
    zh: '蛋白质：平均 {0} 克/天，目标 {1} 克',
  },
  'RHR': {
    ar: 'معدل الراحة', de: 'Ruhepuls', es: 'FC en reposo', fr: 'FC au repos', hi: 'आराम दर',
    hu: 'Nyugalmi pulzus', it: 'FC a riposo', ko: '안정시 맥박', pl: 'Tętno spoczynkowe',
    pt: 'FC em repouso', ru: 'Пульс покоя', th: 'ชีพจังหวะขณะพัก', tr: 'Dinlenme nabzı',
    uk: 'Пульс спокою', zh: '静息心率',
  },
  'Steps: {0}/day avg': {
    ar: 'الخطوات: {0}/يوم في المتوسط', de: 'Schritte: {0}/Tag im Mittel',
    es: 'Pasos: {0}/día de media', fr: 'Pas : {0}/jour en moyenne', hi: 'कदम: औसत {0}/दिन',
    hu: 'Lépés: átlagosan {0}/nap', it: 'Passi: media {0}/giorno', ko: '걸음: 평균 {0}보/일',
    pl: 'Kroki: średnio {0}/dzień', pt: 'Passos: média de {0}/dia', ru: 'Шаги: в среднем {0}/день',
    th: 'ก้าว: เฉลี่ย {0}/วัน', tr: 'Adım: ortalama {0}/gün', uk: 'Кроки: у середньому {0}/день',
    zh: '步数：平均 {0}/天',
  },
  'fasting avg {0}': {
    ar: 'متوسط الصيام {0}', de: 'Fasten im Mittel {0}', es: 'Ayuno medio {0}',
    fr: 'Jeûne moyen {0}', hi: 'औसत उपवास {0}', hu: 'Böjt átlagosan {0}', it: 'Digiuno medio {0}',
    ko: '단식 평균 {0}', pl: 'Post średnio {0}', pt: 'Jejum médio {0}', ru: 'Разгрузка в среднем {0}',
    th: 'ถือศีลอดเฉลี่ย {0}', tr: 'Oruç ortalaması {0}', uk: 'Пост у середньому {0}',
    zh: '断食平均 {0}',
  },
  'from FitAI': {
    ar: 'من FitAI', de: 'aus FitAI', es: 'desde FitAI', fr: 'depuis FitAI', hi: 'FitAI से',
    hu: 'FitAI-ból', it: 'da FitAI', ko: 'FitAI에서', pl: 'z FitAI', pt: 'do FitAI',
    ru: 'из FitAI', th: 'จาก FitAI', tr: 'FitAI’den', uk: 'з FitAI', zh: '来自 FitAI',
  },
  'h sleep': {
    ar: 'س نوم', de: 'h Schlaf', es: 'h de sueño', fr: 'h de sommeil', hi: 'घंटे नींद',
    hu: 'óra alvás', it: 'h di sonno', ko: '시간 수면', pl: 'h snu', pt: 'h de sono',
    ru: 'ч сна', th: 'ชม. นอน', tr: 'saat uyku', uk: 'год сну', zh: '小时睡眠',
  },
  'hello {0}': {
    ar: 'مرحبًا {0}', de: 'Hallo {0}', es: 'Hola {0}', fr: 'Bonjour {0}', hi: 'नमस्ते {0}',
    hu: 'Szia {0}', it: 'Ciao {0}', ko: '안녕하세요 {0}', pl: 'Cześć {0}', pt: 'Olá {0}',
    ru: 'Привет, {0}', th: 'สวัสดี {0}', tr: 'Merhaba {0}', uk: 'Привіт, {0}', zh: '你好 {0}',
  },
  'kcal': {
    ar: 'سعرة', de: 'kcal', es: 'kcal', fr: 'kcal', hi: 'केसर', hu: 'kcal', it: 'kcal',
    ko: 'kcal', pl: 'kcal', pt: 'kcal', ru: 'ккал', th: 'kcal', tr: 'kcal', uk: 'ккал',
    zh: '千卡',
  },
  'latest {0}': {
    ar: 'آخر {0}', de: 'zuletzt {0}', es: 'último {0}', fr: 'dernier {0}', hi: 'नवीनतम {0}',
    hu: 'legutóbbi {0}', it: 'ultimo {0}', ko: '최근 {0}', pl: 'najnowszy {0}',
    pt: 'mais recente {0}', ru: 'последнее {0}', th: 'ล่าสุด {0}', tr: 'son {0}',
    uk: 'останнє {0}', zh: '最新 {0}',
  },
  'protein': {
    ar: 'بروتين', de: 'Protein', es: 'Proteína', fr: 'Protéines', hi: 'प्रोटीन', hu: 'Fehérje',
    it: 'Proteine', ko: '단백질', pl: 'Białko', pt: 'Proteína', ru: 'Белок', th: 'โปรตีน',
    tr: 'Protein', uk: 'Білок', zh: '蛋白质',
  },
  'steps/day': {
    ar: 'خطوة/يوم', de: 'Schritte/Tag', es: 'pasos/día', fr: 'pas/jour', hi: 'कदम/दिन',
    hu: 'lépés/nap', it: 'passi/giorno', ko: '보/일', pl: 'kroki/dzień', pt: 'passos/dia',
    ru: 'шагов/день', th: 'ก้าว/วัน', tr: 'adım/gün', uk: 'кроків/день', zh: '步/天',
  },
  '{0} days logged': {
    ar: '{0} أيام مسجلة', de: '{0} Tage erfasst', es: '{0} días registrados',
    fr: '{0} jours saisis', hi: '{0} दिन दर्ज', hu: '{0} nap rögzítve', it: '{0} giorni registrati',
    ko: '{0}일 기록', pl: 'zapisanych {0} dni', pt: '{0} dias registados', ru: 'записано {0} дн.',
    th: 'บันทึก {0} วัน', tr: '{0} gün kayıtlı', uk: 'записано {0} дн.', zh: '已记录 {0} 天',
  },
  '{0} kcal under target this week': {
    ar: '{0} سعرة تحت الهدف هذا الأسبوع', de: '{0} kcal unter dem Ziel diese Woche',
    es: '{0} kcal por debajo del objetivo esta semana',
    fr: '{0} kcal sous l’objectif cette semaine', hi: 'इस हफ़्ते लक्ष्य से {0} सैररी कम',
    hu: '{0} kcal a heti cél alatt', it: '{0} kcal sotto l’obiettivo questa settimana',
    ko: '이번 주 목표보다 {0} kcal 적음', pl: '{0} kcal poniżej celu w tym tygodniu',
    pt: '{0} kcal abaixo do objetivo esta semana', ru: '{0} ккал ниже цели на эту неделю',
    th: 'สัปดาห์นี้ต่ำกว่าเป้าหมาย {0} kcal', tr: 'Bu hafta hedefin {0} kcal altında',
    uk: '{0} ккал нижче цієї тижні', zh: '本周低于目标 {0} 千卡',
  },
  '{0} kg': {
    ar: '{0} كجم', de: '{0} kg', es: '{0} kg', fr: '{0} kg', hi: '{0} किग्रा', hu: '{0} kg',
    it: '{0} kg', ko: '{0} kg', pl: '{0} kg', pt: '{0} kg', ru: '{0} кг', th: '{0} กก.',
    tr: '{0} kg', uk: '{0} кг', zh: '{0} 千克',
  },
  '{0} kg lean': {
    ar: 'الكتلة الصافية {0} كجم', de: '{0} kg fettfreie Masse', es: '{0} kg de masa magra',
    fr: '{0} kg de masse maigre', hi: 'लीन मास {0} किग्रा', hu: '{0} kg zsírmentes tömeg',
    it: '{0} kg di massa magra', ko: '리스마스크 {0} kg', pl: '{0} kg masy ciała beztłuszczowej',
    pt: '{0} kg de massa magra', ru: '{0} кг тощей массы', th: 'มวลเนื้อสลีน {0} กก.',
    tr: '{0} kg yağsız kütle', uk: '{0} кг жирової маси', zh: '去脂体重 {0} 千克',
  },
  '{0}% body fat': {
    ar: '{0}% من دهون الجسم', de: '{0} % Körperfett', es: '{0} % de grasa corporal',
    fr: '{0} % de masse grasse', hi: 'शरीर की चर्बी {0}%', hu: '{0}% testzsír',
    it: '{0}% di grasso corporeo', ko: '체지방 {0}%', pl: '{0}% tłuszczu ciała',
    pt: '{0}% de gordura corporal', ru: '{0}% жира в теле', th: 'ไขมันในร่างกาย {0}%',
    tr: 'Vücut yağ oranı %{0}', uk: '{0}% жиру в тілі', zh: '体脂 {0}%',
  },
  '{0}g short of your protein target': {
    ar: 'ينقصك {0}غ من هدف البروتين', de: '{0} g bis zum Proteinziel fehlen',
    es: 'Faltan {0} g para tu objetivo de proteína',
    fr: 'Il manque {0} g à votre objectif de protéines',
    hi: 'प्रोटीन लक्ष्य में {0} ग्राम की कमी है',
    hu: '{0} g hiányzik a fehérjelégcélból', it: 'Mancano {0} g all’obiettivo di proteine',
    ko: '단백질 목표까지 {0} g 부족합니다', pl: 'Brakuje {0} g do celu białka',
    pt: 'Faltam {0} g para a tua meta de proteína',
    ru: 'До цели по белку не хватает {0} г', th: 'ขาดโปรตีนอีก {0} กรัมถึงเป้าหมาย',
    tr: 'Protein hedefine {0} g kaldı', uk: 'До цілі по білку бракує {0} г',
    zh: '距离蛋白质目标还差 {0} 克',
  },
}

const esc = s => s.replace(/'/g, "\\'")
const ANCHOR = "\n  '{0}. {1}':"

for (const file of fs.readdirSync(dir).filter(f => f.endsWith('.js') && f !== 'pt-BR.js')) {
  const loc = file.replace('.js', '')
  const path = `${dir}/${file}`
  const text = fs.readFileSync(path, 'utf8')
  const eol = text.includes('\r\n') ? '\r\n' : '\n'
  const at = text.indexOf(ANCHOR)
  if (at < 0) throw new Error(`${file}: anchor not found`)
  const end = text.indexOf('\n', at) + 1

  const lines = [`${eol}${eol}  // FitAI numbers the readiness and the session targets are set from.`]
  for (const [en, byLoc] of Object.entries(STRINGS)) {
    const tr = byLoc[loc]
    if (!tr) throw new Error(`${file}: no translation for ${en}`)
    lines.push(`${eol}  '${esc(en)}': '${esc(tr)}',`)
  }
  fs.writeFileSync(path, text.slice(0, end) + lines.join('') + text.slice(end))
  console.log(`${file.padEnd(9)} +${Object.keys(STRINGS).length} keys`)
}