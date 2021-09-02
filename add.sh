#!/bin/bash

# $1 - filename
# $2 - hash

curl -H "Content-type:application/json" --data '{"data" : "'$1'/'$2'"}' http://localhost:3001/mineBlock

