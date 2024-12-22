const fs = require('fs');

const url = 'https://rust.scmm.app/api/';
const itemsPerPage = 500;

async function throttleRequests(requests, maxParallel) {
    const results = [];
    while (requests.length > 0) {
        const batch = requests.splice(0, maxParallel);
        const batchResults = await Promise.all(batch.map(fn => fn()));
        results.push(...batchResults);
    }
    return results;
}

async function fetchData(start) {
    console.log(`Fetching items from start=${start} with count=${itemsPerPage}...`);
    const response = await fetch(`${url}item?exactMatch=false&start=${start}&count=${itemsPerPage}&detailed=true`);
    return await response.json();
}

async function fetchPaginatedData() {
    console.log('Starting initial request to determine total items...');
    const firstResponse = await fetchData(0);
    const totalItems = firstResponse.total;
    const totalRequests = Math.ceil(totalItems / itemsPerPage);
    console.log(`Total items: ${totalItems}. Total requests required: ${totalRequests}.`);
    const requests = [];
    for (let i = 1; i < totalRequests; i++) {
        const start = i * itemsPerPage;
        requests.push(() => fetchData(start));
    }
    const responses = await throttleRequests(requests, 3);
    const allItems = [
        ...firstResponse.items,
        ...responses.flatMap(response => response.items)
    ];

    console.log(`Fetched a total of ${allItems.length} items.`);
    return allItems;
}

function transformToSkinFormat(items) {
    const skinData = items.reduce((acc, item) => {
        if (item.workshopFileId == null) {
            return acc;
        }
        let skinEntry = acc.find(entry => entry["Item Shortname"] === item.itemShortName);
        if (!skinEntry) {
            skinEntry = {
                "Item Shortname": item.itemShortName,
                "Permission": "",
                "Skins": []
            };
            acc.push(skinEntry);
        }
        skinEntry.Skins.push(item.workshopFileId);
        return acc;
    }, []);

    return { "Skins": skinData };
}

async function main() {
    try {
        const allItems = await fetchPaginatedData();
        const formattedData = transformToSkinFormat(allItems);
        fs.writeFileSync('items.json', JSON.stringify(formattedData, null, 2));
        console.log('All items have been written to items.json');
    } catch (error) {
        console.error('Error fetching data:', error);
    }
}

main();