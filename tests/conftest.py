"""pytest 全局配置与 fixture。"""
import sys
from pathlib import Path

# 把项目根目录加入 sys.path，方便 import
PROJECT_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(PROJECT_ROOT))