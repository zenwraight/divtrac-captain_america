1. docker build . -t hunter/node-web-app
2. docker run -p 8080:8080 -d hunter/node-web-app
3. docker ps -f "status=exited"
4. docker ps
5. docker logs <container-id>

## Connect to Redis using redis-cli

1. docker pull redis
2. docker run -d --name redis1 redis
3. docker exec -it redis1 bash
4. redis-cli -h redis-15388.c8.us-east-1-3.ec2.cloud.redislabs.com -p 15388 -a 3AUdWYIGTUX33OoyyYp65sqvWDNleFoS# divtrac-captain_america
