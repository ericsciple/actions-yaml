#!/bin/bash

set -e

echo 'Checking if installed'
if [ ! -f install.done ]; then
  rm -rf staging || true
  mkdir -p staging

  echo 'Checking if node exists'
  if [ ! -f node.done ]; then
    rm -rf node || true

    echo 'Downloading node'
    pushd staging
    curl -LO https://nodejs.org/dist/v14.18.1/node-v14.18.1-linux-x64.tar.xz
    tar -vxJf node-v14.18.1-linux-x64.tar.xz
    popd

    mv staging/node-v14.18.1-linux-x64 node
    touch node.done
    echo 'Finished downloading node'
  else
    echo 'Already exists'
  fi

  echo 'Checking if actions-yml exists'
  if [ ! -f actions.yaml.done ]; then
    rm -rf actions.yaml

    echo 'Download actions-yaml'
    pushd staging
    curl -LO https://github.com/ericsciple/actions-yaml/releases/download/v0.1/actions-yaml.tar.xz
    mkdir -p actions-yaml
    tar -xvJ -C actions-yaml -f actions-yaml.tar.xz
    popd

    mv staging/actions-yaml actions-yaml
    touch actions-yaml.done
    echo 'Finished downloading actions-yaml'
  else
    'Already exists'
  fi

  touch install.done
  echo 'Finished installing'
else
  echo 'Already installed'
fi
