#!/usr/bin/env python3
"""Сервер для работы над залом: раздаёт корень проекта и велит браузеру каждый раз сверять файлы.

Обычный `python3 -m http.server` не говорит браузеру, сколько хранить файл, и тот решает сам: давно не менявшийся модуль
берётся из запаса, а только что изменённый — свежий. Если они перестали сходиться (новый room.js просит у старого glass.js
то, чего в нём нет), зал не собирается вовсе. С этим сервером браузер перед каждым использованием спрашивает, не изменился
ли файл (`no-cache`): неизменённые модели и текстуры заново не качаются, изменённое всегда свежее.

    python3 tools/serve.py          # http://localhost:5210/
    python3 tools/serve.py 5211
"""
import sys
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path


class Fresh(SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header('Cache-Control', 'no-cache')
        super().end_headers()

    # Одно соединение на много файлов: зал при открытии просит больше сотни файлов разом.
    protocol_version = 'HTTP/1.1'

    def log_message(self, *args):
        pass


class Server(ThreadingHTTPServer):
    # Очередь новых соединений побольше: при пяти (как у Python по умолчанию) часть запросов залпа получала отказ,
    # и случайный файл не доходил — раз звук клавиш, раз звук каретки.
    request_queue_size = 128


if __name__ == '__main__':
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 5210
    root = Path(__file__).resolve().parent.parent
    Server(('127.0.0.1', port), partial(Fresh, directory=str(root))).serve_forever()
