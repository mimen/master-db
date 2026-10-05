#!/usr/bin/env python3
"""Reduce retained native measurements and optionally pair WebKit proxy medians."""
import argparse
import gzip
import shutil
import json
import math
from pathlib import Path
import statistics
import subprocess

NAMES = ["switch", "rapid-switch", "list-scroll", "thread-scroll", "search", "compose", "lens-tabs", "details", "command-palette", "preview-switch", "rapid-preview"]
PROXY = dict(zip(NAMES, ["conversation.switch", "conversation.rapid-switch", "list.scroll", "thread.scroll", "search.type", "compose.type", "lens.switch", "details.toggle", "palette.open", "preview.switch", "preview.rapid"]))


def stats(values):
    ordered = sorted(values)
    if not ordered:
        return None
    return {"n": len(ordered), "median": statistics.median(ordered), "p90": ordered[math.ceil(len(ordered) * .9) - 1], "min": ordered[0], "max": ordered[-1]}


def correlation(pairs):
    if len(pairs) < 3:
        return None
    a, b = zip(*pairs)
    try:
        return statistics.correlation(a, b)
    except statistics.StatisticsError:
        return None


def reduce_run(run):
    results = {}
    for name in NAMES:
        trials = [t for t in run["trials"] if t["interaction"] == name]
        successful = [t for t in trials if t["status"] == "measured"]
        results[name] = {"attempted": len([t for t in trials if t["repetition"] > 0]), "successful": len(successful),
                         "first": stats([t["firstMs"] for t in successful]), "settled": stats([t["settledMs"] for t in successful]),
                         "confirmed": stats([t["confirmedMs"] for t in successful]),
                         "reasons": [t["reason"] for t in trials if t.get("reason")],
                         "outcomes": [t["status"] for t in trials]}
    return results


def pair(value):
    return "unavailable" if value is None else f"{value['median']:.1f} / {value['p90']:.1f}"


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("output", type=Path)
    parser.add_argument("--native", type=Path, action="append", required=True)
    parser.add_argument("--build", default="unknown")
    parser.add_argument("--baseline", type=Path)
    args = parser.parse_args()
    output = args.output.resolve()
    runs = {}
    sources = {}
    if args.baseline:
        baseline = json.loads(args.baseline.read_text())
        if baseline.get("app") != "Messages" or not baseline.get("run"):
            raise ValueError("baseline must contain a native Messages run")
        runs["Messages"] = baseline["run"]
        sources["Messages"] = args.baseline.parent
    for source in args.native:
        for run in json.loads(source.read_text()):
            for trial in run["trials"]:
                if trial.get("evidence"):
                    trial["evidence"] = str((source.parent / trial["evidence"]).resolve())
                if trial["interaction"] == "rapid-preview":
                    trial["status"] = "unattributed-overlap"
                    trial["reason"] = "A first navigation was still painting. Pixel changes after the second key cannot be attributed to its destination, so raw onset is not a valid second-input latency."
            app = run["app"]
            if app not in runs:
                runs[app] = run
            else:
                previous = runs[app]
                for name in {t["interaction"] for t in run["trials"]}:
                    incoming = [t for t in run["trials"] if t["interaction"] == name]
                    existing = [t for t in previous["trials"] if t["interaction"] == name]
                    if sum(t["repetition"] > 0 for t in incoming) > sum(t["repetition"] > 0 for t in existing):
                        previous["trials"] = [t for t in previous["trials"] if t["interaction"] != name] + incoming
                if run.get("error"):
                    previous["error"] = "; ".join(filter(None, [previous.get("error"), f"{source}: {run['error']}"]))
                previous["elapsedMs"] += run["elapsedMs"]
                previous["cleanupVerified"] &= run["cleanupVerified"]
                previous["restoredFrontmost"] &= run["restoredFrontmost"]
            sources[app] = source.parent
    results = {name: reduce_run(run) for name, run in runs.items()}
    calibration_path = output / "calibration.json"
    calibration = json.loads(calibration_path.read_text()) if calibration_path.exists() else {"error": "not run"}
    clock_ns = calibration["machNumer"] / calibration["machDenom"]
    measured_hz = calibration.get("displayMaximumHz", 0)
    pacing = {}
    delivery, processing = [], []
    for app, run in runs.items():
        for trial in run["trials"]:
            for frame in trial["frames"]:
                delivery.append((frame["arrivalTicks"] - frame["displayTicks"]) * clock_ns / 1e6)
                processing.append(frame["processingMs"])
            active = [f["displayTicks"] for f in trial["frames"] if trial.get("inputTicks", 0) <= f["displayTicks"] <= trial.get("lastInputTicks", 0)]
            gaps = [(b-a) * clock_ns / 1e6 for a, b in zip(active, active[1:])]
            if "scroll" in trial["interaction"]:
                key = f"{app}/{trial['interaction']}"
                pacing.setdefault(key, []).extend(gaps)
            if trial.get("evidence"):
                directory = sources[app] / trial["evidence"]
                images = [directory / name for name in ["before.png", "first.png", "after.png"]]
                if trial["frames"] and (directory / "frames.bgra").exists():
                    last = len(trial["frames"]) - 1
                    subprocess.run(["ffmpeg", "-loglevel", "error", "-y", "-f", "rawvideo", "-pixel_format", "bgra", "-video_size", f"{trial['width']}x{trial['height']}", "-i", str(directory / "frames.bgra"), "-vf", f"select=eq(n\\,{last})", "-frames:v", "1", str(directory / "after.png")], check=True)
                if all(p.exists() for p in images):
                    subprocess.run(["ffmpeg", "-loglevel", "error", "-y", *sum((["-i", str(p)] for p in images), []),
                                    "-filter_complex", "hstack=inputs=3", "-frames:v", "1", str(directory / "strip.png")], check=True)
                raw = directory / "frames.bgra"
                if raw.exists() and raw.stat().st_size:
                    expected = trial["width"] * trial["height"] * 4 * len(trial["frames"])
                    if raw.stat().st_size != expected:
                        raise ValueError(f"frame bytes disagree with timeline: {raw}")
                    temporary = directory / "frames.bgra.gz.tmp"
                    with raw.open("rb") as source, gzip.open(temporary, "wb", compresslevel=1) as dest:
                        shutil.copyfileobj(source, dest)
                    temporary.replace(directory / "frames.bgra.gz")
                    raw.unlink()
    calibration["realRunDeliveryMs"] = stats(delivery)
    calibration["realRunProcessingMs"] = stats(processing)
    calibration["semantics"] = "Synthetic render submission to compositor frame is not HID input overhead. Display-to-callback and pixel processing are instrument costs. No overhead was subtracted."
    proxy_path = output / "webkit-proxy.json"
    proxy = json.loads(proxy_path.read_text()) if proxy_path.exists() else None
    proxy_results = {r["id"]: r for r in proxy["results"]} if proxy else {}
    matched_proxy = output / "matched-proxy" / "webkit-proxy.json"
    if matched_proxy.exists():
        proxy_results.update({r["id"]: r for r in json.loads(matched_proxy.read_text())["results"]})
    preview_proxy = output / "preview-proxy" / "webkit-proxy.json"
    if preview_proxy.exists():
        proxy_results.update({r["id"]: r for r in json.loads(preview_proxy.read_text())["results"]})
    correlations = {}
    for metric, proxy_metric in [("first", "firstResponseMs"), ("settled", "settledMs")]:
        pairs = []
        labels = []
        for name in NAMES:
            native = results.get("Comma", {}).get(name, {}).get(metric)
            proxied = proxy_results.get(PROXY[name], {}).get(proxy_metric)
            if native and proxied and proxied.get("samples") and not proxied.get("capped"):
                pairs.append((native["median"], proxied["median"]))
                labels.append(name)
        correlations[metric] = {"pearsonAcrossInteractionMedians": correlation(pairs), "pairs": pairs, "interactions": labels,
                                "interpretation": "Descriptive only. Native CGEvent-to-pixels and headless event-to-DOM/rAF use different clocks, work, gestures, and runtime instances. This is not a calibrated prediction of Comma.app."}
    comparison = []
    for name in NAMES:
        m = results.get("Messages", {}).get(name, {})
        c = results.get("Comma", {}).get(name, {})
        row = {"interaction": name, "Messages": m, "Comma": c}
        for metric in ["first", "settled"]:
            row[metric + "Ratio"] = c[metric]["median"] / m[metric]["median"] if m.get(metric) and c.get(metric) and m[metric]["median"] else None
        comparison.append(row)
    identity_path = output / "native-build.json"
    identity = json.loads(identity_path.read_text()) if identity_path.exists() else {}
    running_build = identity.get("Running web", "unverified")
    report = {"kind": "native-latency-comparison", "commaBuild": running_build, "deployedBuild": args.build, "nativeBuildEvidence": identity, "comparison": comparison, "runs": runs,
              "calibration": calibration, "proxyCorrelation": correlations,
              "capturePacingMsDuringInput": {k: stats(v) for k, v in pacing.items()},
              "displayDrops": "Not identifiable from ScreenCaptureKit complete-frame gaps. Idle frames do not mean dropped display frames.",
              "limitations": ["Strict no-mark policy blocks normal conversation selection. No self-chat typing without verified self identity.",
                              "Visual settling is 300ms of quiet after a response, not proof that backend work finished. Search watches results, not its input field.",
                              "Capture is one pixel per point at requested 240 Hz on a 120 Hz maximum display. Spatial threshold is two pixels with summed RGB delta >12. Plus/minus one frame accuracy is an aim, not validated.",
                              "The runs were sequential on a busy development Mac. Native build identity comes from Settings, not the server release endpoint.",
                              "Keyboard preview is supplemental, not mouse-click parity. Thread scrolling used the already-open Messages chat and a Comma preview, not a matched self-chat pair.",
                              "Messages search ROI was inspected in its retained strip. Matching conversations and inline message results appeared there; the broad query was a. The matched proxy repeats query a and the 16-pulse, 24-point, 8ms scroll schedule. Native and browser event delivery still differ."]}
    if running_build == "unverified" or not args.build.startswith(running_build):
        report["limitations"].append("The native build is not the deployed proxy build. These native measurements predate the deployed performance fixes when the running build is older. Correlation is cross-build and cannot validate proxy accuracy.")
    (output / "report.json").write_text(json.dumps(report, indent=2) + "\n")
    (output / "baseline.json").write_text(json.dumps({"app": "Messages", "results": results.get("Messages"), "run": runs.get("Messages"), "calibration": calibration}, indent=2) + "\n")
    lines = ["# Comma latency comparison", "", f"Native Comma running web: `{running_build}`. Deployed web and fresh proxy: `{args.build}`. Native results are milliseconds, median / p90. Each measured row has five repeats unless its count says otherwise.", "", "| Interaction | Messages first | Comma first | First ratio | Messages settled | Comma settled | Settled ratio |", "|---|---:|---:|---:|---:|---:|---:|"]
    for row in comparison:
        m, c = row["Messages"], row["Comma"]
        ratio = lambda key: "n/a" if row[key] is None else f"{row[key]:.2f}x"
        lines.append(f"| {row['interaction']} | {pair(m.get('first'))} | {pair(c.get('first'))} | {ratio('firstRatio')} | {pair(m.get('settled'))} | {pair(c.get('settled'))} | {ratio('settledRatio')} |")
    lines += ["", "Settled time is the last changed frame or final input, confirmed after another 300ms. Confirmation times are retained separately.", "", "## Calibration", "", f"Synthetic render submission to frame: {stats(calibration.get('renderSubmissionToFrameMs', []))}.", f"Display to callback: {calibration['realRunDeliveryMs']}.", f"ROI processing: {calibration['realRunProcessingMs']}.", "", calibration['semantics'], "", "## Proxy correlation", "", json.dumps(correlations, indent=2), "", "## Coverage and evidence", ""]
    for app, run in runs.items():
        lines.append(f"{app}: {run['elapsedMs']/1000:.2f}s, cleanup verified {run['cleanupVerified']}, frontmost restored {run['restoredFrontmost']}, system-wide hit pid {run.get('hitTestPid')}, app pid {run['pid']}. Error: {run.get('error', 'none')}.")
        for name, row in results[app].items():
            lines.append(f"- {app} {name}: {row['successful']}/{row['attempted']} measured. {'; '.join(row['reasons'])}")
        for trial in run["trials"]:
            if trial.get("evidence"):
                path = sources[app] / trial["evidence"]
                lines.append(f"- [{app} {trial['interaction']} {trial['repetition']} frames]({path / 'strip.png'}). Losslessly compressed BGRA frames and timestamps are in the same folder.")
    lines += ["", "## Measurement limits", "", *[f"- {x}" for x in report["limitations"]], "- " + report["displayDrops"], "", "The raw JSON retains failed outcomes and the observations behind each number."]
    (output / "report.md").write_text("\n".join(lines) + "\n")
    print("\n".join(lines[:15]))


if __name__ == "__main__":
    main()
