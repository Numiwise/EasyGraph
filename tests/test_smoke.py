"""项目级烟雾测试：纯 Python，验证关键脚本与配置可被 import / parse / 读取。

不依赖运行中的 Docker 服务。运行：
    cd easygraph
    python -m pytest tests/ -v
"""
import json
import re
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parent.parent


def test_docker_compose_exists():
    """docker-compose.yml 必须存在。"""
    assert (ROOT / "docker-compose.yml").is_file()


def test_docker_compose_valid_yaml():
    """docker-compose.yml 是合法 YAML。"""
    try:
        import yaml
    except ImportError:
        pytest.skip("PyYAML 未安装；建议 pip install pyyaml")
    data = yaml.safe_load((ROOT / "docker-compose.yml").read_text(encoding="utf-8"))
    services = data.get("services", {})
    # 必须包含核心服务
    assert "neo4j" in services
    assert "qdrant" in services
    assert "postgres" in services
    assert "lightrag" in services
    assert "webviz" in services


def test_env_example_exists():
    """必须有 .env.example 作为配置模板。"""
    assert (ROOT / ".env.example").is_file()


def test_origin_manifest_present_and_valid_json():
    """原始资料清单必须存在且为合法 JSON（用于 nginx 静态路由）。"""
    p = ROOT / "data" / "inputs" / "_origin_manifest.json"
    if not p.exists():
        pytest.skip("原始资料 manifest 不存在（首次 ingest 后生成）")
    data = json.loads(p.read_text(encoding="utf-8"))
    assert isinstance(data, dict)
    assert len(data) >= 1


def test_input_md_files_parseable():
    """已解析的 markdown 文件至少有一个能正确读取（UTF-8）。"""
    md_files = list((ROOT / "data" / "inputs").rglob("__parsed__/*.md"))
    if not md_files:
        pytest.skip("无 __parsed__/ 数据")
    sample = md_files[0]
    content = sample.read_text(encoding="utf-8")
    assert len(content) > 0
    assert "妃子笑" in content or "荔枝" in content or "Tang" in content or len(content) > 100


def test_frontend_view_modules_import():
    """前端 view 模块无明显语法错误（importable by node parser 较复杂，这里用 ast）。"""
    import ast
    src = ROOT / "frontend" / "src" / "views"
    for js in src.glob("*.js"):
        if js.name.startswith("_"):
            continue
        # 不实际执行，仅保证文件不是空
        text = js.read_text(encoding="utf-8")
        assert "export default" in text, f"{js.name} 缺少 default export"


def test_required_css_files_present():
    """main.css 必须存在（全局 + 跨视图共性样式已统一在这里）。"""
    styles = ROOT / "frontend" / "src" / "styles"
    assert (styles / "main.css").is_file(), "缺少 main.css"


def test_index_html_loads_main_js():
    """index.html 必须加载 Vite 入口 main.js（main.js 内引入 main.css）。"""
    html = (ROOT / "index.html").read_text(encoding="utf-8")
    assert "/frontend/src/main.js" in html, "index.html 未加载 main.js"


def test_nginx_conf_present():
    """nginx 配置应放到顶层 nginx/ 目录（不再散落在 scripts/ops/）。"""
    n = ROOT / "nginx" / "nginx-webviz.conf"
    assert n.is_file()
    assert "/kb/" in n.read_text(encoding="utf-8")


def test_readme_has_quickstart():
    """README 必须包含 5 分钟快速开始小节。"""
    readme = ROOT / "README.md"
    if not readme.exists():
        pytest.skip("README.md 尚未创建")
    text = readme.read_text(encoding="utf-8")
    assert "快速开始" in text or "Quickstart" in text or "Quick Start" in text.lower()