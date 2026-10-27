import { resolveCname } from "node:dns/promises"
import { NODATA } from "node:dns"

type DomainResolution = {
    domain: string,
    cname_chain: string[],
    url?: string,
    redirect?: DomainResolution
}

function normalize(domain: string) {
    return domain.toLowerCase()
}

async function withEmptyOnNoData<T>(fn: () => Promise<T[]>): Promise<T[]> {
    try {
        return await fn();
    } catch (error) {
        if (error instanceof Error && (error as NodeJS.ErrnoException).code === NODATA) return []
        throw error
    }
}

const MAX_HOPS = 20

/**
 * Resolves the full CNAME chain for a URL, starting at its hostname.
 * Follows single-target CNAMEs up to MAX_HOPS; stops on NODATA or ambiguity.
 *
 * @param url - The URL whose hostname is resolved.
 * @param redirect - The resolution of the next redirect target, attached when present.
 * @returns The resolution for the URL, including its CNAME chain.
 */
async function createDomainResolution(url: string, redirect?: DomainResolution): Promise<DomainResolution> {
    const domain = new URL(url).hostname

    let current = domain
    const chain = []
    
    let hops = 0
    while (hops++ < MAX_HOPS) {
        const cnames = await withEmptyOnNoData(() => resolveCname(current))
        if (cnames.length === 0) break
        if (cnames.length !== 1) break

        const cname = normalize(cnames[0]!)
        chain.push(cname)
        current = cname
    }
    
    const newEntry: DomainResolution = {
        domain: domain,
        cname_chain: chain,
        url: url
    }

    if (redirect) newEntry.redirect = redirect

    return newEntry
}

/**
 * Resolves a URL and flattens its CNAME chain into one entry per suffix,
 * so every CNAME target in the chain is representable as its own resolution.
 * The first entry carries the URL; subsequent entries carry their own suffix chain.
 *
 * @param url - The URL whose hostname is resolved.
 * @param redirect - The resolution of the next redirect target, attached to every entry when present.
 * @returns One resolution per suffix of the CNAME chain, starting with the URL itself.
 */
async function createDomainResolutionLayer(url: string, redirect?: DomainResolution): Promise<DomainResolution[]> {
    const outputArray: DomainResolution[] = []
    
    let currentEntry: DomainResolution

    if (redirect) {
        currentEntry = await createDomainResolution(url, redirect)
    } else {
        currentEntry = await createDomainResolution(url)
    }

    outputArray.push(currentEntry)

    const chain: string[] = currentEntry.cname_chain

    for (let i = 0; i < chain.length; i++) {
        const cnameChain = chain.slice(i)
        const cnameEntry: DomainResolution = {
            domain: chain[i]!,
            cname_chain: cnameChain
        }

        if (redirect) cnameEntry.redirect = redirect

        outputArray.push(cnameEntry)
    }

    return outputArray
}

/**
 * Resolves a redirect chain and returns a cache keyed by each suffix of the chain,
 * mapping to that suffix's resolution layer. Built so that a shorter chain
 * converging on a known suffix can reuse the precomputed resolution.
 *
 * @param redirectChain - The ordered URLs of the redirect chain.
 * @returns A record mapping each suffix key to its resolution layer.
 */
async function createDomainResolutionRecord(redirectChain: string[]): Promise<Record<string, DomainResolution[]>> {
    const outputRecord: Record<string, DomainResolution[]> = {}
    let lastDomainResolution: DomainResolution | undefined

    for (let i = redirectChain.length - 1; i >= 0; --i) {
        let currentDomainResolutionLayer: DomainResolution[]
        if (lastDomainResolution) {
            currentDomainResolutionLayer = await createDomainResolutionLayer(redirectChain[i]!, lastDomainResolution)
        } else {
            currentDomainResolutionLayer = await createDomainResolutionLayer(redirectChain[i]!)
        }

        const key = redirectChain.slice(i).join("")
        outputRecord[key] = currentDomainResolutionLayer

        lastDomainResolution = currentDomainResolutionLayer[0]!
    }

    return outputRecord
}

/**
 * Appends the resolution layer for a redirect chain to `domainResolutionData`,
 * reusing a precomputed record entry when the chain is already cached and
 * resolving from scratch otherwise.
 *
 * @param redirectChain - The ordered URLs of the redirect chain.
 * @param domainResolutionRecord - The cache of precomputed resolution layers, keyed by chain suffix.
 * @param domainResolutionData - The output array the resolved layer is appended to.
 * @returns Resolves when the layer has been appended.
 */
async function extendDomainResolutionData(redirectChain: string[], domainResolutionRecord:Record<string, DomainResolution[]>, domainResolutionData: DomainResolution[]): Promise<void> {
    const key = redirectChain.join("")
    const recordExtension: DomainResolution[] | undefined = domainResolutionRecord[key]

    if (recordExtension) {
        domainResolutionData.push(...recordExtension)
        console.info(`Domain Resolutions have been added for ${recordExtension[0]!.domain}`)
    } else {
        let newExtension: DomainResolution[] | undefined
        let lastDomainResolution: DomainResolution | undefined

        for (let i = redirectChain.length - 1; i >= 0; --i) {
            if (i !== 0) {
                if (lastDomainResolution) {
                    lastDomainResolution = await createDomainResolution(redirectChain[i]!, lastDomainResolution)
                } else {
                    lastDomainResolution = await createDomainResolution(redirectChain[i]!)
                }
            } else {
                if (lastDomainResolution) {
                    newExtension = await createDomainResolutionLayer(redirectChain[i]!, lastDomainResolution)
                } else {
                    newExtension = await createDomainResolutionLayer(redirectChain[i]!)
                }
            }
        }
        domainResolutionData.push(...newExtension!)
        if (newExtension && newExtension.length) console.info(`Domain Resolutions have been created and added for ${newExtension[0]!.domain}`)
    }
}

import { writeFileSync } from "node:fs";

const record = await createDomainResolutionRecord(["https://office.com", "https://www.office.com", "https://m365.cloud.microsoft"])

const drd: DomainResolution[] = []
await extendDomainResolutionData(["https://office.com", "https://www.office.com", "https://m365.cloud.microsoft"], record, drd)
await extendDomainResolutionData(["https://www.office.com", "https://m365.cloud.microsoft"], record, drd)
await extendDomainResolutionData(["https://ard.de", "https://www.ard.de"], record, drd)
writeFileSync("./out.json", JSON.stringify(drd, null, 2), "utf8");

// const drd: DomainResolution[] = []
// await extendDomainResolutionData(["https://office.com", "https://www.office.com", "https://m365.cloud.microsoft"], {}, drd)
// writeFileSync("./out.json", JSON.stringify(drd, null, 2), "utf8");


