#!/bin/bash
set -e

hugo

cd public
git add .
git commit -m "Deploy $(date)"
git push origin main

cd ..
git add public
git commit -m "Update public submodule"
git push
