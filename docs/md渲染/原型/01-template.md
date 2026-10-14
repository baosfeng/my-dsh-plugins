# 01 模版选择

template: web-prototype
platform: desktop
mode: prototype
理由: 目标是一页桌面 Web 对话面（非营销页、非移动端）。内置模版里没有"对话渲染"专用模版，
     按 SKILL.md 的规则选最接近的通用模版 web-prototype 再改：它的 seed 已给好排版尺度、
     间距阶梯、栅格与 chrome，8 个 section 骨架里 Layout 3（三列/卡片组）、Layout 7（列表）、
     Layout 8（对照表）可直接改造为"渲染元素/源码对照"。
自带资源: assets/template.html（seed，349 行）, references/layouts.md（8 个骨架）, references/checklist.md（P0/P1/P2）
seed 的 6 个变量: --bg --surface --fg --muted --border --accent（骨架阶段只占位，第 4 步换风格取值）
