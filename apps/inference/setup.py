#!/usr/bin/env python
"""
Setup script for ClaudeBench Inference Server
"""

from setuptools import setup, find_packages
from pathlib import Path

# Read the README file
this_directory = Path(__file__).parent
long_description = (this_directory / "README.md").read_text()

setup(
    name="claudebench-inference",
    version="0.1.0",
    description="ClaudeBench Inference Server - LLM sampling service using claude-code-sdk",
    long_description=long_description,
    long_description_content_type="text/markdown",
    author="ClaudeBench Team",
    python_requires=">=3.10",
    package_dir={"": "src"},
    packages=find_packages(where="src"),
    package_data={
        "claudebench_inference": [
            "templates/*.j2",
            "py.typed"
        ],
    },
    include_package_data=True,
    install_requires=[
        "fastapi>=0.115.0",
        "uvicorn[standard]>=0.32.0",
        "pydantic>=2.10.0",
        "python-dotenv>=1.0.0",
        "httpx>=0.27.0",
        "jinja2>=3.1.0",
        "claude-code-sdk>=0.0.23",
    ],
    extras_require={
        "dev": [
            "pytest>=8.3.0",
            "pytest-asyncio>=0.24.0",
            "pytest-cov>=6.0.0",
            "black>=24.10.0",
            "ruff>=0.8.0",
            "mypy>=1.13.0",
        ],
    },
    entry_points={
        "console_scripts": [
            "claudebench-inference=claudebench_inference.main:main",
        ],
    },
    classifiers=[
        "Development Status :: 3 - Alpha",
        "Intended Audience :: Developers",
        "Programming Language :: Python :: 3",
        "Programming Language :: Python :: 3.10",
        "Programming Language :: Python :: 3.11",
        "Programming Language :: Python :: 3.12",
    ],
)