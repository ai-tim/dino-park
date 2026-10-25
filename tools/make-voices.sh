#!/usr/bin/env bash
# Пересобирает голоса видов из исходных записей (нужен ffmpeg). Запуск: bash tools/make-voices.sh
set -e
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SRC="${SRC:-$ROOT/legacy/demos/audio}"
cd "$ROOT/assets/audio/voices"
mk() { # species n source rate extra
  mkdir -p $1
  sr=$(ffprobe -v error -select_streams a:0 -show_entries stream=sample_rate -of csv=p=0 $SRC/$3.mp3)
  af="asetrate=$(python3 -c "print(int($sr*$4))"),aresample=44100,silenceremove=start_periods=1:start_threshold=-45dB,areverse,silenceremove=start_periods=1:start_threshold=-45dB,areverse${5:+,$5},loudnorm=I=-17:TP=-1.5:LRA=11"
  ffmpeg -v error -y -i $SRC/$3.mp3 -af "$af" -ac 1 -ar 44100 -b:a 96k /tmp/v.mp3
  # плавное затухание в конце
  d=$(ffprobe -v error -show_entries format=duration -of csv=p=0 /tmp/v.mp3)
  ffmpeg -v error -y -i /tmp/v.mp3 -af "afade=t=in:d=0.02,afade=t=out:st=$(python3 -c "print(max(0,$d-0.25))"):d=0.25" -ac 1 -ar 44100 -b:a 96k $1/$2.mp3
}
mk trex 1 dino4_2 1.0
mk trex 2 dino3_2 0.9
mk brachiosaurus 1 dino1_1 0.82
mk brachiosaurus 2 dino4_2 0.88 "aecho=0.8:0.6:60:0.25"
mk ankylosaurus 1 dino4_1 0.95
mk ankylosaurus 2 dino1_1 1.08
mk triceratops 1 dino1_2 1.0
mk triceratops 2 dino2_2 0.92
mk stegosaurus 1 dino0_2 1.0
mk stegosaurus 2 dino4_1 0.88
mk parasaurolophus 1 dino2_1 1.0
mk parasaurolophus 2 dino1_2 1.22
mk plesiosaur 1 dino2_2 0.9 "aecho=0.8:0.7:90|160:0.3|0.2"
mk plesiosaur 2 dino0_2 0.86 "aecho=0.8:0.7:110:0.3"
mk pterodactyl 1 dino3_1 1.05
mk pterodactyl 2 dino0_1 1.15
mk velociraptor 1 dino2_1 1.38
mk velociraptor 2 dino0_1 1.3
