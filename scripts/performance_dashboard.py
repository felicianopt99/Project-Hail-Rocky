#!/usr/bin/env python3
import json
import os
import glob
from rich.console import Console
from rich.table import Table
from rich.panel import Panel
from rich.layout import Layout
from rich.live import Live
from rich import box
from datetime import datetime

console = Console()

def load_latest_report():
    reports_dir = os.path.join(os.path.dirname(__file__), "reports")
    list_of_files = glob.glob(f'{reports_dir}/report_*.json')
    if not list_of_files:
        return None
    latest_file = max(list_of_files, key=os.path.getctime)
    with open(latest_file, 'r') as f:
        return json.load(f), latest_file

def display_dashboard():
    data, filename = load_latest_report()
    if not data:
        console.print("[red]No reports found in scripts/reports/[/red]")
        return

    metadata = data["metadata"]
    summary = data["summary"]
    benchmarks = data["benchmarks"]
    results = data["raw_results"]

    # Header Panel
    console.print(Panel(
        f"[bold cyan]Project Hail Rocky - QA Insights Dashboard[/bold cyan]\n"
        f"[dim]Report: {os.path.basename(filename)} | Time: {metadata['timestamp']}[/dim]",
        box=box.DOUBLE_EDGE,
        border_style="blue"
    ))

    # Summary Stats
    summary_table = Table(box=box.SIMPLE, expand=True)
    summary_table.add_column("Metric", style="white")
    summary_table.add_column("Value", style="bold yellow")
    
    summary_table.add_row("Total Scenarios", str(summary["total"]))
    summary_table.add_row("Pass Rate", f"{summary['passed']}/{summary['total']} ({int(summary['passed']/summary['total']*100)}%)")
    summary_table.add_row("Avg Personality Score", f"{summary['avg_personality_score']}%")
    summary_table.add_row("Concurrency", str(metadata["concurrency"]))

    console.print(Panel(summary_table, title="[bold green]Summary[/bold green]", border_style="green"))

    # Benchmarks
    bench_table = Table(box=box.SIMPLE, expand=True)
    bench_table.add_column("Pipeline Stage", style="white")
    bench_table.add_column("Avg Latency", style="bold magenta")
    bench_table.add_column("P95", style="magenta")
    bench_table.add_column("Jitter", style="dim")

    bench_table.add_row("STT (Voice -> Text)", f"{benchmarks['stt_latency']['avg']}ms", f"{benchmarks['stt_latency']['p95']}ms", f"±{benchmarks['stt_latency']['jitter']}ms")
    bench_table.add_row("LLM TTFT (First Token)", f"{benchmarks['llm_ttft']['avg']}ms", f"{benchmarks['llm_ttft']['p95']}ms", f"±{benchmarks['llm_ttft']['jitter']}ms")
    bench_table.add_row("Generation Throughput", f"{benchmarks['tokens_per_second']['avg']} t/s", "-", "-")

    console.print(Panel(bench_table, title="[bold magenta]Performance Benchmarks[/bold magenta]", border_style="magenta"))

    # Detailed Results
    res_table = Table(title="Detailed Scenario Results", box=box.MINIMAL_DOUBLE_HEAD, expand=True)
    res_table.add_column("ID", style="dim", width=12)
    res_table.add_column("Scenario", width=25)
    res_table.add_column("Status", width=10)
    res_table.add_column("Score", justify="right")
    res_table.add_column("TTFT", justify="right")
    res_table.add_column("Reason", style="italic")

    for res in results:
        status_color = "green" if res["status"] == "PASS" else "red"
        score_color = "green" if res["metrics"]["personality_score"] > 70 else "yellow" if res["metrics"]["personality_score"] > 40 else "red"
        
        res_table.add_row(
            res["test_case"]["id"],
            res["test_case"]["name"],
            f"[{status_color}]{res['status']}[/{status_color}]",
            f"[{score_color}]{res['metrics']['personality_score']}%[/{score_color}]",
            f"{int(res['metrics']['llm_ttft_ms'] or 0)}ms",
            res["reason"]
        )

    console.print(res_table)

if __name__ == "__main__":
    display_dashboard()
