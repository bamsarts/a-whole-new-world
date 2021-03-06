import Q from 'q';
import schedule from 'node-schedule';
import moment from 'moment-timezone';
import _ from 'lodash';
import stringFormat from 'string-format';
import config from '../config/server-config.js';
import * as logger from '../utils/logger.js';
import * as github from '../utils/github.js';
import * as rollProcessor from '../command-processors/roll-processor.js';

export let job = null;
export const jobSchedule = '0 0 15 * * 3';
export const farmProduction = '/roll 1d12+12';
export const farmersRequired = 2;

export const messages = {
    famineTitle: '@{login} feed your population!',
    famine: '@{login}\'s village of {villageName} has famine in their population! \n\n There are {farmCount} active farms, which produced enough to feed {production} people this week. An additional {hungerCount} people need food.',
    starvation: '@{login}\'s village, {villageName} had {deathCount} people starve to death.',
    wipeOut: '@{login}\'s village has all starved to death. Their village has been removed, and their points have been reduced to 0.',
    resolved: '@{login} has resolved their villages hungry population.'
};

export const labelTitles = {
    hunger: 'Hunger'
};

export const scheduleJob = function () {
    if (job) {
        job.cancel();
    }
    job = schedule.scheduleJob(jobSchedule, processHunger);
    logger.info('Creating Hunger Job. Next Run: ' + getNextRun());
};

export const getNextRun = function () {
    if (job) {
        return moment(job.pendingInvocations()[0].fireDate).tz(config.timezone).format('M/D/YY HH:mm z');
    }
    return 'NONE';
};

export const createHungerIssue = function (player, production) {
    const message = stringFormat(messages.famine, {
        login: player.name,
        villageName: player.village.name,
        farmCount: getActiveFarms(player),
        production: production,
        hungerCount: player.village.hunger
    });
    
    logger.log('  - ' + message);
    
    return github.post({
        endpoint: 'issues',
        data: {
            title: stringFormat(messages.famineTitle, {login: player.name}),
            body: message,
            assignee: player.name,
            labels: [
                labelTitles.hunger
            ]
        }
    }).catch(logger.error);
};

export const closeHungerIssues = function (player) {
    if (_.get(player, 'village.hunger') <= 0) {
        return github.get({
            endpoint: 'issues',
            query: {
                labels: labelTitles.hunger,
                per_page: 100
            }
        }).then(function (issues) {
            if (!issues || !issues.length) {
                return;
            }
            return Q.all(_.map(issues, function (issue) {
                if (issue.assignee.login === player.name) {
                    return github.sendCommentMessage(issue.comments_url, stringFormat(messages.resolved, {login: player.name}))
                    .then(function () {
                        return github.patch({
                            path: issue.url,
                            data: {
                                state: 'closed'
                            }
                        });
                    });
                }
            }));
        })
        .catch(logger.error);
    }
    return Q.when();
};

export const reducePopulation = function (player, amount) {
    if (!_.get(player, 'village.population') || !_.isObject(player.village.population)) {
        return 0;
    }
    if (amount <= player.village.population.general) {
        player.village.population.general -= amount;
        return 0;
    }

    amount += player.village.population.general;
    player.village.population.general = 0;

    const keys = _.keys(player.village.population);

    _.each(keys, function (key, index) {
        if (player.village.population[key] <= 0) {
            keys.splice(index, 1);
        }
    });

    _.times(amount, function () {
        const index = _.random(0, keys.length - 1);
        const key = keys[index];

        if (!keys.length) {
            return;
        }

        player.village.population[key]--;
        amount--;
        if (player.village.population[key] <= 0) {
            keys.splice(index, 1);
        }
    });

    return amount;

};

export const processStarvation = function (playerData, player) {
    const populationCount = getTotalPopulation(player);
    const deathCount = Math.min(populationCount, player.village.hunger);

    const message = stringFormat(messages.starvation, {
        login: player.name,
        villageName: player.village.name,
        deathCount: deathCount
    });

    logger.log('  - ' + message);

    reducePopulation(player, deathCount);

    player.village.hunger = 0;

    github.updatePlayerFile(playerData, message);

    return deathCount;
};

export const getActiveFarms = function (player, farmCount) {
    const farms = farmCount || _.get(player, 'village.farms', 0);
    const farmers = _.get(player, 'village.population.farming', 0);

    return Math.floor(Math.max(0, farms - Math.max(0, farms * farmersRequired - farmers) / farmersRequired));
};

export const processFarmProduction = function (player, farms) {
    const activeFarms = getActiveFarms(player, farms);
    const production = _.sum(_.times(activeFarms, _.partial(rollProcessor.sum, farmProduction, {})));
    const currentHunger = _.get(player, 'village.hunger', 0);

    logger.log('  - Processing Farm Production for ' + player.name + ': ' + activeFarms + ' - ' + production);

    if (!player || !player.village) {
        return 0;
    }

    player.village.hunger = currentHunger - production;

    return production;
};

export const processPlayerHunger = function (playerData, player) {
    if (!player.village) {
        logger.log('  - ' + player.name + ': NO VILLAGE');
        return;
    }

    if (!player.village.population) {
        logger.log('  - ' + player.name + ': NO POPULATION');
        return;
    }

    if (_.isNumber(player.village.population)) {
        player.village.population = {
            general: player.village.population
        };
    }

    if (player.village.hunger > 0) {
        processStarvation(playerData, player);
    }

    if (getTotalPopulation(player) === 0) {
        delete player.village;
        player.points = 0;
        github.updatePlayerFile(playerData, stringFormat(messages.wipeOut, {
            login: player.name
        }));
        return;
    }

    const production = processFarmProduction(player);
    const populationCount = getTotalPopulation(player);

    player.village.hunger += populationCount;

    logger.log('  - ' + player.name + ': population - ' + populationCount + ' | hunger: ' + player.village.hunger);

    if (player.village.hunger > 0 ) {
        createHungerIssue(player, production);
    }
};

export const processHunger = function () {
    logger.info('Performing Hunger Process...');
    
    return github.getPlayerData()
        .then(function (playerData){
            if (!playerData.activePlayers) {
                logger.warn('No active players found!');
                return;
            }

            logger.log(' :: ' + playerData.activePlayers.length + ' active players :: ');

            _.each(playerData.activePlayers, _.partial(processPlayerHunger, playerData));

            return github.updatePlayerFile(playerData, 'Feeding the population.')
                .finally(function () {
                    logger.info('Finished Hunger Process. Next Hunger Job Scheduled to run at ' + getNextRun());
                });
        });
};

export const getTotalPopulation = function (player) {
    return _.sum(_.values(_.get(player, 'village.population')));
};
