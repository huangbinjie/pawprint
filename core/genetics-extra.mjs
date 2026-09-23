export function expandTraits(traits) {
  for (const list of Object.values(traits))
    for (const g of list) g.weight *= 100;
  const coats = [
    ["焦糖", "#BA8559", "#795338", 900],
    ["奶茶", "#D5C2AA", "#A08772", 900],
    ["灰蓝", "#889CAD", "#546777", 700],
    ["赤棕", "#A96751", "#713F36", 500],
    ["丁香", "#B8A9C8", "#80708F", 200],
    ["雾青", "#A9BBB2", "#778B80", 300],
    ["暖桃", "#E2B5A0", "#AC7D6A", 250],
    ["铅灰", "#737C80", "#434E53", 800],
    ["银霜", "#D2DADD", "#929EA6", 100],
    ["浅沙", "#DBD0AC", "#A99D77", 700],
    ["莓紫", "#AD869C", "#785769", 80],
    ["夜蓝", "#3D4D68", "#253448", 8],
    ["月光", "#EEE9D5", "#B9B29C", 5],
  ];
  traits.coat.push(
    ...coats.map(([name, color, shade, weight]) => ({
      name,
      color,
      shade,
      weight,
    })),
  );
  const eyes = [
    ["蜜金", "#D9B44B", 700],
    ["墨玉", "#497968", 500],
    ["雾灰", "#93A0A3", 800],
    ["赤铜", "#A76547", 600],
    ["苔绿", "#728052", 1000],
    ["浅榛", "#B6A275", 600],
    ["紫金异瞳", "#9B79B5", 8, "#D1AC46"],
    ["蓝绿异瞳", "#72ADC8", 5, "#73A988"],
  ];
  traits.eyes.push(
    ...eyes.map(([name, color, weight, other]) => ({
      name,
      color,
      weight,
      ...(other ? { other } : {}),
    })),
  );
  traits.eyeSize.push(
    { name: "微圆眼", weight: 1200, scale: 0.68 },
    { name: "大杏眼", weight: 450, scale: 1.15, sx: 1.2, sy: 0.8 },
    { name: "扁圆眼", weight: 1000, scale: 0.9, sx: 1.1, sy: 0.66 },
    { name: "窄豆眼", weight: 900, scale: 0.6, sx: 0.8, sy: 0.8 },
    { name: "水滴眼", weight: 15, scale: 1.12, sx: 0.9, sy: 1.12 },
  );
  traits.body.push(
    { name: "小巧", weight: 1200, sx: 0.88, sy: 0.89 },
    { name: "宽肩", weight: 600, sx: 1.19, sy: 0.98 },
    { name: "高挑", weight: 350, sx: 0.82, sy: 1.08 },
    { name: "梨形", belly: 10, weight: 650, sx: 1.12, sy: 1.04 },
    { name: "袖珍", weight: 20, sx: 0.77, sy: 0.79 },
    { name: "壮硕", weight: 50, sx: 1.21, sy: 1 },
  );
  traits.face.push(
    { name: "短圆脸", weight: 1000, sx: 1.03, sy: 0.82 },
    { name: "小方脸", shape: "square", weight: 800, sx: 0.9, sy: 0.9 },
    { name: "宽扁脸", weight: 750, sx: 1.16, sy: 0.8 },
    { name: "细长脸", weight: 600, sx: 0.75, sy: 1.12 },
    { name: "心形脸", shape: "heart", weight: 100, sx: 1.08, sy: 0.97 },
    { name: "小三角脸", shape: "triangle", weight: 15, sx: 0.81, sy: 0.98 },
  );
  traits.eyeSpacing.push(
    { name: "低眼位", weight: 900, dx: 0, dy: 0, yOffset: 8 },
    { name: "窄高眼位", weight: 650, dx: -7, dy: 0, yOffset: -5 },
    { name: "偏低左眼", weight: 500, dx: 2, dy: -6, yOffset: 6 },
    { name: "舒展眼位", weight: 20, dx: 7, dy: 0, yOffset: -3 },
  );
  traits.pupil = [
    { name: "自然竖瞳", weight: 4000, rx: 4.5, ry: 10 },
    { name: "圆瞳", weight: 2200, rx: 7, ry: 7 },
    { name: "细线瞳", weight: 1700, rx: 2, ry: 11 },
    { name: "大圆瞳", weight: 1100, rx: 8, ry: 9 },
    { name: "短竖瞳", weight: 800, rx: 4, ry: 6 },
    { name: "椭圆瞳", weight: 180, rx: 6, ry: 10 },
    { name: "针瞳", weight: 20, rx: 1.5, ry: 8 },
  ];
  traits.muzzle = [
    { name: "自然口吻", weight: 3500, sx: 1, sy: 1 },
    { name: "小口吻", weight: 2200, sx: 0.7, sy: 0.75 },
    { name: "宽口吻", weight: 1700, sx: 1.25, sy: 0.88 },
    { name: "长口吻", weight: 1500, sx: 0.82, sy: 1.18 },
    { name: "饱满口吻", weight: 800, sx: 1.2, sy: 1.15 },
    { name: "扁口吻", weight: 280, sx: 1.12, sy: 0.62 },
    { name: "精巧口吻", weight: 20, sx: 0.6, sy: 0.65 },
  ];
  traits.nose = [
    { name: "自然粉鼻", weight: 3500, color: "#A1746F", sx: 1, sy: 1 },
    { name: "黑鼻", weight: 2300, color: "#393C3C", sx: 1, sy: 1 },
    { name: "棕鼻", weight: 1700, color: "#796150", sx: 1, sy: 1 },
    { name: "小粉鼻", weight: 1200, color: "#C19592", sx: 0.7, sy: 0.8 },
    { name: "宽鼻", weight: 850, color: "#8B7465", sx: 1.3, sy: 0.88 },
    { name: "深红鼻", weight: 350, color: "#985D5E", sx: 1, sy: 1 },
    { name: "灰鼻", weight: 90, color: "#91959B", sx: 0.92, sy: 1 },
    { name: "浅桃鼻", weight: 10, color: "#DCB5AA", sx: 0.8, sy: 0.85 },
  ];
  traits.patternScale = [
    { name: "标准分布", weight: 3000, sx: 1, sy: 1, rotation: 0 },
    { name: "细密分布", weight: 2000, sx: 0.7, sy: 0.75, rotation: 0 },
    { name: "大块分布", weight: 1700, sx: 1.35, sy: 1.25, rotation: 0 },
    { name: "斜向分布", weight: 1300, sx: 1, sy: 1, rotation: 22 },
    { name: "横向铺开", weight: 1000, sx: 1.3, sy: 0.8, rotation: 0 },
    { name: "纵向延展", weight: 700, sx: 0.8, sy: 1.3, rotation: 0 },
    { name: "错落分布", weight: 280, sx: 1.15, sy: 0.85, rotation: -18 },
    { name: "微斑分布", weight: 20, sx: 0.55, sy: 0.6, rotation: 8 },
  ];
}
