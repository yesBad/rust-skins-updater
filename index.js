const fs = require('fs');

// SCMM moved its API to api.scmm.app, and paging is now 1-based page/pageSize (max 500).
const url = 'https://api.scmm.app/api/';
const itemsPerPage = 500;
const maxAttempts = 4;

// SCMM shortnames that don't match the in-game item shortname.
const shortNameFixes = {
    "lr300.item": "rifle.lr300"
};

async function throttleRequests(requests, maxParallel) {
    const results = [];
    while (requests.length > 0) {
        const batch = requests.splice(0, maxParallel);
        const batchResults = await Promise.all(batch.map(fn => fn()));
        results.push(...batchResults);
    }
    return results;
}

async function fetchData(page) {
    for (let attempt = 1; ; attempt++) {
        try {
            console.log(`Fetching page=${page} with pageSize=${itemsPerPage}...`);
            const response = await fetch(`${url}item?exactMatch=false&page=${page}&pageSize=${itemsPerPage}&detailed=true`);
            if (!response.ok) {
                throw new Error(`HTTP ${response.status}`);
            }
            return await response.json();
        } catch (error) {
            if (attempt >= maxAttempts) {
                throw new Error(`page ${page} failed after ${maxAttempts} attempts: ${error.message}`);
            }
            await new Promise(resolve => setTimeout(resolve, 2000 * attempt));
        }
    }
}

async function fetchPaginatedData() {
  console.log('Starting initial request to determine total items...');
  const firstResponse = await fetchData(1);

  const totalItems = firstResponse.total;
  const totalRequests = Math.ceil(totalItems / itemsPerPage);
  console.log(`Total items: ${totalItems}. Total requests required: ${totalRequests}.`);

  const requests = [];
  for (let page = 2; page <= totalRequests; page++) {
    requests.push(() => fetchData(page));
  }

  const responses = await throttleRequests(requests, 3);

  const badPages = [];
  const pageItems = responses.flatMap((response, i) => {
    if (!response || !Array.isArray(response.items)) {
      badPages.push({ page: i + 2, keys: response ? Object.keys(response) : null });
      return [];
    }
    return response.items;
  });

  if (badPages.length) {
    throw new Error(`Some pages had no items array: ${JSON.stringify(badPages, null, 2)}`);
  }

  // Dedupe by guid: store/DLC items without a workshop file all have id 0.
  const itemsByGuid = new Map();
  for (const item of [...(firstResponse.items ?? []), ...pageItems]) {
    itemsByGuid.set(item.guid, item);
  }
  // Don't publish a partial list.
  if (itemsByGuid.size !== totalItems) {
    throw new Error(`Fetched ${itemsByGuid.size} unique items but the API reports ${totalItems}.`);
  }

  const allItems = [...itemsByGuid.values()];
  console.log(`Fetched a total of ${allItems.length} items.`);
  return allItems;
}

function transformToSkinFormat(items) {
    const skinData = items.reduce((acc, item) => {
        if (item.workshopFileId == null) {
            return acc;
        }
        if (item.itemShortName == "miscellanous") {
            switch (item.itemType) {
                case "Large Backpack":
                    item.itemShortName = "largebackpack"
                    break;

                case "Spinning wheel":
                    item.itemShortName = "spinner.wheel"
                    break;
                    
                default:
                    return acc;
            }
        }
        // I dont know why I did above, we shall see soon lol
        // Update: it was cause stupid api i fix some ay sdf dfgdfgngdf
        item.itemShortName = shortNameFixes[item.itemShortName] ?? item.itemShortName;

        let skinEntry = acc.find(entry => entry["Item Shortname"] === item.itemShortName);
        if (!skinEntry) {
            skinEntry = {
                "Item Shortname": item.itemShortName,
                "Permission": "",
                "Skins": []
            };
            acc.push(skinEntry);
        }
        if (!skinEntry.Skins.includes(item.workshopFileId)) {
            skinEntry.Skins.push(item.workshopFileId);
        }
        return acc;
    }, []);

    return { "Skins": skinData };
}

async function main() {
    try {
        const allItems = await fetchPaginatedData();
        const formattedData = transformToSkinFormat(allItems);

        formattedData.Skins.sort((a, b) =>
          (a["Item Shortname"] ?? "").localeCompare(
            (b["Item Shortname"] ?? ""),
            undefined,
            { sensitivity: "base" }
          )
        );
        
        fs.writeFileSync('items.json', JSON.stringify(formattedData, null, 2));
        console.log('All items have been written to items.json');
    } catch (error) {
        console.error('Error fetching data:', error);
        // Fail the workflow instead of silently keeping the old items.json.
        process.exitCode = 1;
    }
}

main();
